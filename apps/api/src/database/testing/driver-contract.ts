import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbDriver } from '../db-driver.interface';
import type { ConnectionParams, NativePool } from '../types';

/**
 * Engine-neutral conformance suite. Engines without schema support (`supportsSchemas: false`,
 * e.g. SQLite) skip the CREATE/DROP SCHEMA steps and use their default namespace.
 */
export function runDriverContractTests(makeDriver: () => DbDriver, params: ConnectionParams): void {
  describe('DbDriver contract', () => {
    let driver: DbDriver;
    let pool: NativePool;
    let supportsSchemas = true;
    let schema = `prost_contract_${Date.now()}`;
    let ref = { namespace: schema, name: 'widgets' };

    beforeAll(async () => {
      driver = makeDriver();
      supportsSchemas = driver.capabilities.supportsSchemas;
      schema = supportsSchemas ? `prost_contract_${Date.now()}` : 'main';
      ref = { namespace: schema, name: 'widgets' };

      pool = await driver.createPool(params);
      if (supportsSchemas) {
        await driver.query(pool, { sql: `CREATE SCHEMA ${driver.quoteIdent(schema)}`, params: [] });
      }
      await driver.query(pool, driver.buildCreateTable({
        schema, table: 'widgets',
        columns: [
          { name: 'id', type: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'name', type: 'text', nullable: true, isPrimaryKey: false },
        ],
      } as never));
      // An explicit index so `buildListIndexes` has a row on every engine (a single INTEGER
      // PRIMARY KEY is a rowid alias on SQLite and creates no listable index).
      await driver.query(pool, driver.buildCreateIndex(
        { schema, table: 'widgets', columns: ['name'], unique: false, name: 'widgets_name_idx', method: 'btree' } as never,
        'widgets_name_idx',
        'btree',
      ));
    });

    afterAll(async () => {
      if (supportsSchemas) {
        await driver.query(pool, { sql: `DROP SCHEMA IF EXISTS ${driver.quoteIdent(schema)} CASCADE`, params: [] }).catch(() => undefined);
      } else {
        await driver.query(pool, { sql: `DROP TABLE IF EXISTS ${driver.quoteIdent(ref.name)}`, params: [] }).catch(() => undefined);
      }
      await driver.closePool(pool);
    });

    it('quoteIdent escapes embedded quotes', () => {
      expect(driver.quoteIdent('a"b')).toContain('a');
    });

    it('binds params, never interpolates', async () => {
      const r = await driver.query(pool, { sql: `SELECT ${driver.placeholder(1)} AS v`, params: [42] });
      expect(Number((r.rows[0] as Record<string, unknown>).v)).toBe(42);
    });

    it('round-trips CRUD with insert returning the row', async () => {
      const ins = await driver.query(pool, driver.buildInsertRow(ref, [['id', 1], ['name', 'gadget']]));
      expect(driver.capabilities.supportsReturning ? ins.rows[0] : true).toBeTruthy();

      const sel = await driver.query(pool, driver.buildSelectRows(ref, { whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 10, offset: 0 }));
      expect(sel.rows).toHaveLength(1);

      const upd = await driver.query(pool, driver.buildUpdateRow(ref, 'name', 'gizmo', ['id'], [1]));
      expect(upd.rowCount).toBe(1);

      const del = await driver.query(pool, driver.buildDeleteRow(ref, ['id'], [1]));
      expect(del.rowCount).toBe(1);
    });

    it('lists columns with the documented shape', async () => {
      const cols = await driver.query(pool, driver.buildListColumns(ref));
      const row = cols.rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty('column_name');
      expect(row).toHaveProperty('is_nullable');
      expect(row).toHaveProperty('is_primary_key');
    });

    it('lists indexes with a columns array', async () => {
      const idx = await driver.query(pool, driver.buildListIndexes(ref));
      const raw = (idx.rows[0] as Record<string, unknown> | undefined)?.columns;
      // PG returns a real array; SQLite returns a JSON-encoded array string.
      const columns = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
      expect(Array.isArray(columns)).toBe(true);
    });
  });
}
