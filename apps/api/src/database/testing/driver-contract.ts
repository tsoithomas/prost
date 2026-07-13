import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import type { ColumnMetadata, NewColumn } from '@prost/shared-types';
import type { DbDriver } from '../db-driver.interface';
import type { ConnectionParams, NativePool, RowUpdateGuard } from '../types';

// Network-level failures that mean "the target DB just isn't running here" (e.g. no
// `docker compose up`, or CI without a Postgres service). These skip the suite rather
// than fail it; any other error still surfaces as a real failure.
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'EPERM']);

// When set (CI), a live network engine that can't be reached fails the suite instead of
// skipping — this is how CI guarantees both PostgreSQL and MySQL were actually exercised.
// File-backed/in-process engines (SQLite) are never "unreachable", so the flag never affects them.
const REQUIRE_LIVE = process.env.REQUIRE_LIVE_DRIVER_CONTRACTS === 'true';

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

    // A live network engine (PG/MySQL) has a host; SQLite runs in-process with an empty host.
    // Only live engines can be "unreachable", so REQUIRE_LIVE only ever fails those.
    const isLiveEngine = params.host !== '';

    beforeAll(async () => {
      driver = makeDriver();
      supportsSchemas = driver.capabilities.supportsSchemas;
      // Schema-aware engines (PG) get a throwaway schema. Schema-less engines reuse their
      // default namespace — SQLite's attached `main`, or for MySQL the connected database
      // (its `defaultNamespace` is unset; "schema" maps to the database).
      schema = supportsSchemas
        ? `prost_contract_${Date.now()}`
        : (driver.descriptor.defaultNamespace ?? params.database);
      ref = { namespace: schema, name: 'widgets' };

      try {
        pool = await driver.createPool(params);
        // Force a real round-trip — pg pools connect lazily, so createPool alone won't reveal
        // that the server is down. A connection error here flips the suite to skip mode.
        await driver.query(pool, { sql: 'SELECT 1', params: [] });
      } catch (err) {
        if (isUnreachable(err)) {
          // In required-live mode an unreachable live engine is a hard failure — CI must not
          // silently skip a database it was supposed to validate.
          if (REQUIRE_LIVE && isLiveEngine) {
            throw new Error(
              `REQUIRE_LIVE_DRIVER_CONTRACTS is set but the ${driver.engine} target at ${params.host}:${params.port} is unreachable`,
            );
          }
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
          { name: 'rank', type: 'integer', nullable: true, isPrimaryKey: false },
        ],
      } as never));
      // An explicit index so `buildListIndexes` has a row on every engine (a single INTEGER
      // PRIMARY KEY is a rowid alias on SQLite and creates no listable index). It's on the
      // integer `rank` column rather than `name`, since MySQL can't index a TEXT column
      // without a prefix length.
      await driver.query(pool, driver.buildCreateIndex(
        { schema, table: 'widgets', columns: ['rank'], unique: false, name: 'widgets_rank_idx', method: 'btree' } as never,
        'widgets_rank_idx',
        'btree',
      ));
      // A child table with a FK to `widgets(id)` so `buildListForeignKeys` has a row on every
      // engine. DDL FK creation is out of scope for the driver builders (read-only phase), so
      // create it with a raw, engine-neutral statement. `INTEGER` and this FK syntax parse on
      // PG, MySQL (InnoDB, referenced PK is indexed), and SQLite alike.
      const qwidgets = supportsSchemas
        ? `${driver.quoteIdent(schema)}.${driver.quoteIdent('widgets')}`
        : driver.quoteIdent('widgets');
      const qparts = supportsSchemas
        ? `${driver.quoteIdent(schema)}.${driver.quoteIdent('widget_parts')}`
        : driver.quoteIdent('widget_parts');
      await driver.query(pool, {
        sql: `CREATE TABLE ${qparts} (
                ${driver.quoteIdent('id')} INTEGER PRIMARY KEY,
                ${driver.quoteIdent('widget_id')} INTEGER,
                CONSTRAINT widget_parts_widget_fk
                  FOREIGN KEY (${driver.quoteIdent('widget_id')})
                  REFERENCES ${qwidgets} (${driver.quoteIdent('id')}) ON DELETE CASCADE
              )`,
        params: [],
      });
    });

    afterAll(async () => {
      if (!pool) return;
      if (supportsSchemas) {
        await driver.query(pool, { sql: `DROP SCHEMA IF EXISTS ${driver.quoteIdent(schema)} CASCADE`, params: [] }).catch(() => undefined);
      } else {
        // Drop the FK child before its parent so engines that enforce FKs (MySQL InnoDB) allow it.
        await driver.query(pool, { sql: `DROP TABLE IF EXISTS ${driver.quoteIdent('widget_parts')}`, params: [] }).catch(() => undefined);
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

    it('lists foreign keys with local/referenced columns and actions', async (ctx) => {
      skipIfUnreachable(ctx);
      // PG returns real arrays; MySQL/SQLite return JSON-encoded array strings.
      const asArray = (raw: unknown): string[] =>
        typeof raw === 'string' ? (JSON.parse(raw) as string[]) : (raw as string[]);
      const fks = await driver.query(pool!, driver.buildListForeignKeys({ namespace: schema, name: 'widget_parts' }));
      const row = fks.rows[0] as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(asArray(row!.columns)).toEqual(['widget_id']);
      expect(row!.referenced_table).toBe('widgets');
      expect(asArray(row!.referenced_columns)).toEqual(['id']);
      // Referential action naming is normalized to the SQL spelling by each builder.
      expect(String(row!.on_delete).toUpperCase()).toBe('CASCADE');
    });

    it('lists referencing foreign keys (the inverse direction) with the child table', async (ctx) => {
      skipIfUnreachable(ctx);
      const asArray = (raw: unknown): string[] =>
        typeof raw === 'string' ? (JSON.parse(raw) as string[]) : (raw as string[]);
      const refs = await driver.query(pool!, driver.buildListReferencingForeignKeys(ref));
      const row = refs.rows.find((r) => (r as Record<string, unknown>).table_name === 'widget_parts') as
        | Record<string, unknown>
        | undefined;
      expect(row).toBeDefined();
      expect(asArray(row!.columns)).toEqual(['widget_id']);
      expect(row!.referenced_table).toBe('widgets');
      expect(asArray(row!.referenced_columns)).toEqual(['id']);
    });

    // Reusable column metadata for the `widgets` table (id PK, nullable name).
    const widgetCols: ColumnMetadata[] = [
      { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
      { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
    ];

    it('filters rows through the dialect WHERE compiler', async (ctx) => {
      skipIfUnreachable(ctx);
      await driver.withTransaction(pool!, (q) => driver.insertRow(q, ref, [['id', 30], ['name', 'filter-a']], widgetCols));
      await driver.withTransaction(pool!, (q) => driver.insertRow(q, ref, [['id', 31], ['name', 'unrelated']], widgetCols));
      try {
        const { quoteIdent, placeholder, likeOperator } = driver.whereDialect;
        const sel = await driver.query(
          pool!,
          driver.buildSelectRows(ref, {
            whereClause: `WHERE ${quoteIdent('name')} ${likeOperator} ${placeholder(1)}`,
            whereParams: ['filter-%'],
            orderColumn: 'id',
            sortDir: 'ASC',
            limit: 10,
            offset: 0,
          }),
        );
        expect(sel.rows).toHaveLength(1);
        expect((sel.rows[0] as Record<string, unknown>).name).toBe('filter-a');
      } finally {
        await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [30])).catch(() => undefined);
        await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [31])).catch(() => undefined);
      }
    });

    it('updateRow changes a primary-key column and returns the new key', async (ctx) => {
      skipIfUnreachable(ctx);
      await driver.withTransaction(pool!, (q) => driver.insertRow(q, ref, [['id', 60], ['name', 'pk-change']], widgetCols));
      try {
        const updated = await driver.withTransaction(pool!, (q) => driver.updateRow(q, ref, 'id', 61, ['id'], [60]));
        expect(Number(updated.id)).toBe(61);
      } finally {
        await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [60])).catch(() => undefined);
        await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [61])).catch(() => undefined);
      }
    });

    it('describeResultColumns resolves result-column type metadata', async (ctx) => {
      skipIfUnreachable(ctx);
      const result = await driver.query(
        pool!,
        driver.buildSelectRows(ref, { whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 1, offset: 0 }),
      );
      const meta = await driver.describeResultColumns((frag) => driver.query(pool!, frag), result.fields, ['id']);
      const idMeta = meta.find((column) => column.name === 'id');
      expect(idMeta).toBeDefined();
      expect(typeof idMeta!.dataType).toBe('string');
      expect(idMeta!.dataType.length).toBeGreaterThan(0);
      expect(idMeta!.isPrimaryKey).toBe(true);
    });

    it('formats an EXPLAIN plan into non-empty text', async (ctx) => {
      skipIfUnreachable(ctx);
      const select = driver.buildSelectRows(ref, { whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 10, offset: 0 });
      // SQLite's bare `EXPLAIN` emits VM bytecode; `EXPLAIN QUERY PLAN` is its human-readable plan.
      const prefix = driver.capabilities.parserDialect === 'sqlite' ? 'EXPLAIN QUERY PLAN ' : 'EXPLAIN ';
      const plan = await driver.query(pool!, { sql: prefix + select.sql, params: select.params });
      const text = driver.formatExplain(plan.rows as Record<string, unknown>[]);
      expect(text.length).toBeGreaterThan(0);
    });

    it('maps a duplicate-table DDL error to a typed exception', async (ctx) => {
      skipIfUnreachable(ctx);
      let mapped: unknown;
      try {
        // `widgets` already exists (created in beforeAll) — recreating it must raise the
        // engine's "already exists" error, which mapError normalizes to a ConflictException.
        await driver.query(
          pool!,
          driver.buildCreateTable({
            schema,
            table: 'widgets',
            columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true }],
          } as never),
        );
      } catch (err) {
        try {
          driver.mapError(err, { operation: 'createTable', ref });
        } catch (typed) {
          mapped = typed;
        }
      }
      expect(mapped).toBeInstanceOf(ConflictException);
    });

    it('streams forward blocks through a cursor and closes on completion', async (ctx) => {
      skipIfUnreachable(ctx);
      if (!driver.capabilities.supportsCursors) {
        (ctx as TestContext & { skip: (note?: string) => void }).skip('engine does not support cursors');
        return;
      }
      const ids = [200, 201, 202, 203, 204];
      for (const id of ids) {
        await driver.query(pool!, driver.buildInsertRow(ref, [['id', id], ['name', `cursor-${id}`]]));
      }
      const { quoteIdent, placeholder } = driver.whereDialect;
      const qualified = supportsSchemas ? `${driver.quoteIdent(schema)}.${driver.quoteIdent(ref.name)}` : driver.quoteIdent(ref.name);
      const sql = `SELECT ${quoteIdent('id')} FROM ${qualified} WHERE ${quoteIdent('id')} >= ${placeholder(1)} ORDER BY ${quoteIdent('id')}`;

      const cursor = await driver.openCursor(pool!, { sql, params: [200] });
      try {
        const first = await cursor.fetch(2);
        expect(first.rows.map((r) => Number(r.id))).toEqual([200, 201]);
        expect(first.complete).toBe(false);
        // Fields are known after the first fetch.
        expect(cursor.columns().some((field) => field.name === 'id')).toBe(true);

        const second = await cursor.fetch(2);
        expect(second.rows.map((r) => Number(r.id))).toEqual([202, 203]);
        expect(second.complete).toBe(false);

        // The final partial block signals completion (fewer rows than requested).
        const third = await cursor.fetch(2);
        expect(third.rows.map((r) => Number(r.id))).toEqual([204]);
        expect(third.complete).toBe(true);
      } finally {
        await cursor.close();
        for (const id of ids) {
          await driver.query(pool!, driver.buildDeleteRow(ref, ['id'], [id])).catch(() => undefined);
        }
      }
    });

    it('inserts into an auto-increment primary key', async (ctx) => {
      skipIfUnreachable(ctx);
      if (!driver.descriptor.ddl.supportsAutoIncrement) {
        (ctx as TestContext & { skip: (note?: string) => void }).skip('engine does not support auto-increment keys');
        return;
      }
      const autoTable = 'widgets_auto';
      const autoRef = { namespace: schema, name: autoTable };
      // PG auto-increments via the `serial` pseudo-type; MySQL via the AUTO_INCREMENT flag.
      const idColumn: NewColumn =
        driver.capabilities.parserDialect === 'postgresql'
          ? { name: 'id', type: 'serial', nullable: false, isPrimaryKey: true }
          : { name: 'id', type: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: true };
      await driver.query(
        pool!,
        driver.buildCreateTable({
          schema,
          table: autoTable,
          columns: [idColumn, { name: 'name', type: 'text', nullable: true, isPrimaryKey: false }],
        } as never),
      );
      try {
        const autoCols: ColumnMetadata[] = [
          { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: true, defaultValue: null },
          { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
        ];
        const inserted = await driver.withTransaction(pool!, (q) => driver.insertRow(q, autoRef, [['name', 'auto']], autoCols));
        expect(Number(inserted.id)).toBeGreaterThan(0);
        expect(inserted.name).toBe('auto');
      } finally {
        const qualified = supportsSchemas ? `${driver.quoteIdent(schema)}.${driver.quoteIdent(autoTable)}` : driver.quoteIdent(autoTable);
        await driver.query(pool!, { sql: `DROP TABLE IF EXISTS ${qualified}`, params: [] }).catch(() => undefined);
      }
    });
  });
}
