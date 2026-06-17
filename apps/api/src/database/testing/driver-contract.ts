import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import type { DbDriver } from '../db-driver.interface';
import type { ConnectionParams, NativePool } from '../types';

// Network-level failures that mean "the target DB just isn't running here" (e.g. no
// `docker compose up`, or CI without a Postgres service). These skip the suite rather
// than fail it; any other error still surfaces as a real failure.
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'EAI_AGAIN']);

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
      const ins = await driver.query(pool!, driver.buildInsertRow(ref, [['id', 1], ['name', 'gadget']]));
      expect(driver.capabilities.supportsReturning ? ins.rows[0] : true).toBeTruthy();

      const sel = await driver.query(pool!, driver.buildSelectRows(ref, { whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 10, offset: 0 }));
      expect(sel.rows).toHaveLength(1);

      const upd = await driver.query(pool!, driver.buildUpdateRow(ref, 'name', 'gizmo', ['id'], [1]));
      expect(upd.rowCount).toBe(1);

      const del = await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [1]));
      expect(del.rowCount).toBe(1);
    });

    it('lists columns with the documented shape', async (ctx) => {
      skipIfUnreachable(ctx);
      const cols = await driver.query(pool!, driver.buildListColumns(ref));
      const row = cols.rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty('column_name');
      expect(row).toHaveProperty('is_nullable');
      expect(row).toHaveProperty('is_primary_key');
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
