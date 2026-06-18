import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import type { DbDriver } from '../db-driver.interface';
import type { ConnectionParams, NativePool, RowUpdateGuard } from '../types';

// Network-level failures that mean "the target DB just isn't running here" (e.g. no
// `docker compose up`, or CI without a Postgres service). These skip the suite rather
// than fail it; any other error still surfaces as a real failure.
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'EPERM']);

function isUnreachable(err: unknown): boolean {
  const e = err as { code?: string; errors?: Array<{ code?: string }> };
  if (e?.code && UNREACHABLE_CODES.has(e.code)) return true;
  // pg surfaces multiple address attempts as an AggregateError with nested codes.
  return Array.isArray(e?.errors) && e.errors.some((inner) => inner?.code && UNREACHABLE_CODES.has(inner.code));
}

/**
 * Engine-neutral conformance suite. Engines without schema support (`supportsSchemas: false`,
 * e.g. SQLite) skip the CREATE/DROP SCHEMA steps and use their default namespace.
 *
 * When the target DB is unreachable (no live server, e.g. CI without a Postgres service),
 * the suite skips every test instead of failing — file-backed engines like SQLite always run.
 */
export function runDriverContractTests(makeDriver: () => DbDriver, params: ConnectionParams): void {
  describe('DbDriver contract', () => {
    let driver: DbDriver;
    let pool: NativePool | undefined;
    let unreachable = false;
    let supportsSchemas = true;
    let schema = `prost_contract_${Date.now()}`;
    let ref = { namespace: schema, name: 'widgets' };

    beforeAll(async () => {
      driver = makeDriver();
      supportsSchemas = driver.capabilities.supportsSchemas;
      schema = supportsSchemas ? `prost_contract_${Date.now()}` : 'main';
      ref = { namespace: schema, name: 'widgets' };

      try {
        pool = await driver.createPool(params);
        // Force a real round-trip — pg pools connect lazily, so createPool alone won't reveal
        // that the server is down. A connection error here flips the suite to skip mode.
        await driver.query(pool, { sql: 'SELECT 1', params: [] });
      } catch (err) {
        if (isUnreachable(err)) {
          unreachable = true;
          return;
        }
        throw err;
      }

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
      if (!pool) return;
      if (supportsSchemas) {
        await driver.query(pool, { sql: `DROP SCHEMA IF EXISTS ${driver.quoteIdent(schema)} CASCADE`, params: [] }).catch(() => undefined);
      } else {
        await driver.query(pool, { sql: `DROP TABLE IF EXISTS ${driver.quoteIdent(ref.name)}`, params: [] }).catch(() => undefined);
      }
      await driver.closePool(pool);
    });

    // `ctx.skip()` is a runtime dynamic-skip on the test context; vitest 2.1.9 ships it but
    // omits it from the TestContext type, so narrow through a local shape.
    const skipIfUnreachable = (ctx: TestContext) => {
      if (unreachable) (ctx as TestContext & { skip: (note?: string) => void }).skip(`target DB unreachable at ${params.host}:${params.port} — skipping live contract`);
    };

    it('quoteIdent escapes embedded quotes', (ctx) => {
      skipIfUnreachable(ctx);
      expect(driver.quoteIdent('a"b')).toContain('a');
    });

    it('binds params, never interpolates', async (ctx) => {
      skipIfUnreachable(ctx);
      const r = await driver.query(pool!, { sql: `SELECT ${driver.placeholder(1)} AS v`, params: [42] });
      expect(Number((r.rows[0] as Record<string, unknown>).v)).toBe(42);
    });

    it('round-trips CRUD with insert returning the row', async (ctx) => {
      skipIfUnreachable(ctx);
      const cols: ColumnMetadata[] = [
        { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
        { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
      ];
      const inserted = await driver.withTransaction(
        pool!,
        (q) => driver.insertRow(q, ref, [['id', 1], ['name', 'gadget']], cols),
      );
      expect(inserted.id).toBe(1);

      const sel = await driver.query(pool!, driver.buildSelectRows(ref, { whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 10, offset: 0 }));
      expect(sel.rows).toHaveLength(1);

      const updated = await driver.withTransaction(
        pool!,
        (q) => driver.updateRow(q, ref, 'name', 'gizmo', ['id'], [1]),
      );
      expect(updated.name).toBe('gizmo');

      const del = await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [1]));
      expect(del.rowCount).toBe(1);
    });

    it('guarded update commits with a fresh guard and conflicts (zero rows) with a stale one', async (ctx) => {
      skipIfUnreachable(ctx);
      await driver.query(pool!, driver.buildInsertRow(ref, [['id', 2], ['name', 'alpha']]));

      const idWhere = `WHERE ${driver.quoteIdent('id')} = ${driver.placeholder(1)}`;
      const freshGuard = async (): Promise<RowUpdateGuard> => {
        if (driver.capabilities.concurrency === 'token') {
          const sel = await driver.query(pool!, driver.buildSelectRows(ref, {
            whereClause: idWhere, whereParams: [2], orderColumn: 'id', sortDir: 'ASC', limit: 1, offset: 0, includeVersion: true,
          }));
          return { kind: 'version', value: String((sel.rows[0] as Record<string, unknown>).__version) };
        }
        // preimage: the current value of the column we're about to edit.
        return { kind: 'preimage', columns: ['name'], values: ['alpha'] };
      };

      const ok = await driver.query(pool!, driver.buildUpdateRowGuarded(ref, [['name', 'beta']], ['id'], [2], await freshGuard()));
      expect(ok.rowCount).toBe(1);

      // The guard captured before the update above is now stale → must match zero rows.
      const stale: RowUpdateGuard =
        driver.capabilities.concurrency === 'token'
          ? { kind: 'version', value: '0' }
          : { kind: 'preimage', columns: ['name'], values: ['alpha'] };
      const conflict = await driver.query(pool!, driver.buildUpdateRowGuarded(ref, [['name', 'gamma']], ['id'], [2], stale));
      expect(conflict.rowCount).toBe(0);

      await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [2]));
    });

    it('withTransaction rolls the whole batch back when fn throws', async (ctx) => {
      skipIfUnreachable(ctx);
      await driver.query(pool!, driver.buildInsertRow(ref, [['id', 3], ['name', 'one']]));

      await expect(
        driver.withTransaction(pool!, async (q) => {
          await q(driver.buildUpdateRow(ref, 'name', 'two', ['id'], [3]));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const sel = await driver.query(pool!, driver.buildSelectRows(ref, {
        whereClause: `WHERE ${driver.quoteIdent('id')} = ${driver.placeholder(1)}`,
        whereParams: [3], orderColumn: 'id', sortDir: 'ASC', limit: 1, offset: 0,
      }));
      expect((sel.rows[0] as Record<string, unknown>).name).toBe('one');

      await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [3]));
    });

    it('updateRow returning the row when set to its current value', async (ctx) => {
      skipIfUnreachable(ctx);
      const cols: ColumnMetadata[] = [
        { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
        { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
      ];
      const id = 2;
      const name = 'unchanged';

      await driver.withTransaction(
        pool!,
        (q) => driver.insertRow(q, ref, [['id', id], ['name', name]], cols),
      );
      const updated = await driver.withTransaction(
        pool!,
        (q) => driver.updateRow(q, ref, 'name', name, ['id'], [id]),
      );

      expect(updated.name).toBe(name);
    });

    it('withTransaction rolls back an executing insertRow on throw', async (ctx) => {
      skipIfUnreachable(ctx);
      const cols: ColumnMetadata[] = [
        { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
        { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
      ];

      await expect(
        driver.withTransaction(pool!, async (q) => {
          await driver.insertRow(q, ref, [['id', 99], ['name', 'rollback']], cols);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const selected = await driver.query(
        pool!,
        driver.buildSelectRows(ref, {
          whereClause: `WHERE ${driver.quoteIdent('id')} = ${driver.placeholder(1)}`,
          whereParams: [99],
          orderColumn: 'id',
          sortDir: 'ASC',
          limit: 10,
          offset: 0,
        }),
      );
      expect(selected.rows).toHaveLength(0);
    });

    it('lists columns with the documented shape', async (ctx) => {
      skipIfUnreachable(ctx);
      const cols = await driver.query(pool!, driver.buildListColumns(ref));
      const row = cols.rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty('column_name');
      expect(row).toHaveProperty('is_nullable');
      expect(row).toHaveProperty('is_primary_key');
      expect(row).toHaveProperty('default_value');
      expect(row).toHaveProperty('is_auto_increment');
    });

    it('lists indexes with a columns array', async (ctx) => {
      skipIfUnreachable(ctx);
      const idx = await driver.query(pool!, driver.buildListIndexes(ref));
      const raw = (idx.rows[0] as Record<string, unknown> | undefined)?.columns;
      // PG returns a real array; SQLite returns a JSON-encoded array string.
      const columns = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
      expect(Array.isArray(columns)).toBe(true);
    });
  });
}
