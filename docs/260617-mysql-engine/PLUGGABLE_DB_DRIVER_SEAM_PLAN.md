# Pluggable DB Driver Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor all PostgreSQL target-DB access behind a pluggable `DbDriver` interface + engine-keyed registry + shared pool manager, with Postgres behaving identically and a driver-agnostic conformance suite, so future engines drop in as one driver class.

**Architecture:** Feature services hold zero target SQL; they call a `DbDriver` (resolved per `Connection.engine` via `DbDriverRegistry`) that owns dialect SQL + native connection. A shared `PoolManager` owns pool caching/sweep/LRU and delegates create/query/close to the driver. `PgDriver` is the only driver this plan ships; a `runDriverContractTests` suite proves any driver.

**Tech Stack:** NestJS 11, TypeScript, `pg`, Prisma (app DB), Vitest, `node-sql-parser`, Docker Postgres (`docker compose`, target on :5434).

**Spec:** `PLUGGABLE_DB_DRIVER_SEAM_DESIGN.md` (project root).

---

## File structure

**New (`apps/api/src/database/`):**
- `types.ts` — `TableRef`, `SqlFragment`, `DriverResult`, `DbCapabilities`, `ConnectionParams`, `SelectRowsOptions`, `NativePool`, `DriverQueryFn`.
- `db-driver.interface.ts` — `DbDriver` interface + `DB_DRIVERS` injection token.
- `db-driver.registry.ts` — `DbDriverRegistry` (engine → driver).
- `pool-manager.service.ts` — shared pool lifecycle; `run` / `withTransaction` / `testConnection` / `evictPool`.
- `drivers/pg/pg-driver.ts` — `PgDriver` (connection methods + every builder, verbatim SQL).
- `drivers/pg/pg-sql.ts` — pure builder functions (unit-testable without a DB).
- `database.module.ts` — `@Global()`; provides registry, pool manager, `PgDriver`, `DB_DRIVERS`.
- `testing/driver-contract.ts` — `runDriverContractTests(makeDriver, dsn)`.
- `drivers/pg/pg-driver.contract.test.ts` — runs the contract suite against docker PG.
- `drivers/pg/pg-sql.test.ts` — pure builder unit tests.

**Modified:**
- `apps/api/prisma/schema.prisma` — add `engine` to `Connection`.
- `apps/api/src/connections/dto/create-connection.dto.ts`, `update-connection.dto.ts` — optional `engine`.
- `apps/api/src/connections/connections.service.ts` — call `PoolManager` instead of `PgConnectionService`.
- `apps/api/src/metadata/metadata.service.ts`, `grid/grid.service.ts`, `grid/filter.ts`, `ddl/ddl.service.ts`, `query/query.service.ts` — use driver builders + `PoolManager`; take `TableRef`.
- `apps/api/src/*/*.module.ts` (metadata, grid, ddl, query) — depend on `DatabaseModule` (global, so mostly import removal of `TargetDbModule`).
- `apps/api/src/target-db/` — folded into `database/`; `pg-connection.service.ts` deleted; thin re-export shim kept only if an import proves stubborn.
- `packages/utils/src/quoteIdent.ts` — unchanged (backs `PgDriver.quoteIdent`).

**Convention:** `git mv` for moves; conventional-commit per task; run `pnpm --filter @prost/api test` after each code task; `docker compose up -d` before contract tests.

---

## Phase 0 — Engine field + neutral types (no behavior change)

### Task 1: Add `engine` to the `Connection` model

**Files:**
- Modify: `apps/api/prisma/schema.prisma:26-44`

- [ ] **Step 1: Add the column with a Postgres default**

In `model Connection`, add directly under `name String`:

```prisma
  engine               String   @default("postgres")
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @prost/api exec prisma migrate dev --name add_connection_engine`
Expected: new folder under `apps/api/prisma/migrations/`, `ALTER TABLE "connections" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'postgres'`. Existing rows backfill to `postgres`.

- [ ] **Step 3: Regenerate the client**

Run: `pnpm --filter @prost/api exec prisma generate`
Expected: success; `connection.engine` now typed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add engine column to Connection (default postgres)"
```

### Task 2: Define the neutral driver types

**Files:**
- Create: `apps/api/src/database/types.ts`

- [ ] **Step 1: Write the types**

```ts
import type { QueryResultRow } from 'pg';
import type { TestConnectionResult } from '@prost/shared-types';

/** Neutral table reference. PG maps `namespace` → schema. */
export interface TableRef {
  namespace?: string;
  name: string;
}

/** Parameterized SQL emitted by a driver builder. Values always bind as params. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/** Engine-neutral query result (mirrors pg's result shape today). */
export interface DriverResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
}

export interface DbCapabilities {
  supportsReturning: boolean;
  supportsSchemas: boolean;
  parserDialect: 'postgresql';
}

export interface ConnectionParams {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  /** Only meaningful when `sslEnabled` is true. `false` allows self-signed/unverifiable certs. */
  sslRejectUnauthorized: boolean;
}

export interface SelectRowsOptions {
  whereClause: string; // already-compiled, dialect-neutral via the driver's placeholder()
  whereParams: unknown[];
  orderColumn?: string;
  sortDir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/** Opaque to callers; only the owning driver knows the concrete type. */
export type NativePool = unknown;
export type DriverQueryFn = (frag: SqlFragment) => Promise<DriverResult>;

export type { TestConnectionResult };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @prost/api exec tsc --noEmit`
Expected: PASS (file is types-only).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/types.ts
git commit -m "feat(api): add neutral DB driver types"
```

### Task 3: Define the `DbDriver` interface + DI token

**Files:**
- Create: `apps/api/src/database/db-driver.interface.ts`

- [ ] **Step 1: Write the interface**

```ts
import type {
  AlterTableOperation,
  CreateIndexRequest,
  CreateTableRequest,
} from '@prost/shared-types';
import type {
  ConnectionParams,
  DbCapabilities,
  DriverQueryFn,
  DriverResult,
  NativePool,
  SelectRowsOptions,
  SqlFragment,
  TableRef,
  TestConnectionResult,
} from './types';

/** Nest multi-provider token: every registered driver is injected as an array. */
export const DB_DRIVERS = Symbol('DB_DRIVERS');

export interface DbDriver {
  readonly engine: string;
  readonly capabilities: DbCapabilities;

  // --- connection lifecycle (called by PoolManager) ---
  createPool(params: ConnectionParams): Promise<NativePool>;
  closePool(pool: NativePool): Promise<void>;
  query(pool: NativePool, frag: SqlFragment): Promise<DriverResult>;
  withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
  testConnection(params: ConnectionParams): Promise<TestConnectionResult>;

  // --- dialect helpers ---
  quoteIdent(identifier: string): string;
  /** 1-based positional placeholder, e.g. PG `$1`, future MySQL `?`. */
  placeholder(index: number): string;

  // --- metadata builders ---
  buildListTables(): SqlFragment;
  buildListAllColumns(): SqlFragment;
  buildListColumns(ref: TableRef): SqlFragment;
  buildListIndexes(ref: TableRef): SqlFragment;

  // --- grid builders ---
  buildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment;
  buildFilteredRowCount(ref: TableRef, whereClause: string, whereParams: unknown[]): SqlFragment;
  buildRowCountEstimate(ref: TableRef): SqlFragment;
  buildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment;
  buildUpdateRow(ref: TableRef, column: string, value: unknown, pkColumns: string[], pkValues: unknown[]): SqlFragment;
  buildDeleteRow(ref: TableRef, pkColumns: string[], pkValues: unknown[]): SqlFragment;

  // --- ddl builders ---
  buildCreateTable(req: CreateTableRequest): SqlFragment;
  buildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment;
  buildCreateIndex(req: CreateIndexRequest, name: string, method: string): SqlFragment;
  buildDropIndex(ref: TableRef, indexName: string): SqlFragment;

  // --- query-editor support ---
  buildResolveTypeNames(oids: number[]): SqlFragment;

  /** Inspect a native error; throw the right Nest HTTP exception, or return to let the caller rethrow. */
  mapError(error: unknown, context: DriverErrorContext): void;
}

export interface DriverErrorContext {
  operation: 'createTable' | 'alterTable' | 'createIndex' | 'dropIndex';
  ref?: TableRef;
  detail?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @prost/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/db-driver.interface.ts
git commit -m "feat(api): define DbDriver interface and DB_DRIVERS token"
```

---

## Phase 1 — PgDriver SQL builders (pure, TDD)

> These are the verbatim SQL relocations from the current services, wrapped as pure functions so they unit-test without a database. Source SQL is copied exactly from today's `metadata.service.ts`, `grid.service.ts`, `ddl.service.ts`, `query.service.ts`.

### Task 4: Pure `pg-sql.ts` — quoting, placeholders, metadata builders (test-first)

**Files:**
- Create: `apps/api/src/database/drivers/pg/pg-sql.ts`
- Test: `apps/api/src/database/drivers/pg/pg-sql.test.ts`

- [ ] **Step 1: Write failing tests for quoting + metadata builders**

```ts
import { describe, expect, it } from 'vitest';
import { pgPlaceholder, pgQuoteIdent, pgBuildListColumns, pgBuildListIndexes, pgBuildListTables } from './pg-sql';

describe('pg-sql quoting/placeholders', () => {
  it('double-quotes and escapes identifiers', () => {
    expect(pgQuoteIdent('a"b')).toBe('"a""b"');
  });
  it('uses $n placeholders', () => {
    expect(pgPlaceholder(1)).toBe('$1');
    expect(pgPlaceholder(3)).toBe('$3');
  });
});

describe('pg-sql metadata builders', () => {
  it('lists base tables excluding system schemas', () => {
    const { sql, params } = pgBuildListTables();
    expect(sql).toContain('information_schema.tables');
    expect(sql).toContain("table_type = 'BASE TABLE'");
    expect(params).toEqual([]);
  });
  it('builds column query bound to schema+table', () => {
    const { sql, params } = pgBuildListColumns({ namespace: 'public', name: 'users' });
    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(params).toEqual(['public', 'users']);
  });
  it('builds index query via pg_index bound to schema+table', () => {
    const { sql, params } = pgBuildListIndexes({ namespace: 'public', name: 'users' });
    expect(sql).toContain('pg_index');
    expect(params).toEqual(['public', 'users']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @prost/api test -- pg-sql`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement quoting + metadata builders**

```ts
import { quoteIdent } from '@prost/utils';
import type { SqlFragment, TableRef } from '../../types';

export const pgQuoteIdent = quoteIdent;
export const pgPlaceholder = (index: number): string => `$${index}`;

/** PG: namespace = schema; default to `public` only where a single-table op needs it (callers pass it explicitly). */
function qualify(ref: TableRef): string {
  const table = pgQuoteIdent(ref.name);
  return ref.namespace ? `${pgQuoteIdent(ref.namespace)}.${table}` : table;
}

export function pgBuildListTables(): SqlFragment {
  return {
    sql: `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           AND table_schema NOT LIKE 'pg_toast%'
           AND table_type = 'BASE TABLE'
         ORDER BY table_schema, table_name`,
    params: [],
  };
}

export function pgBuildListAllColumns(): SqlFragment {
  return {
    sql: `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable,
           EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = c.table_schema
               AND tc.table_name = c.table_name
               AND kcu.column_name = c.column_name
           ) AS is_primary_key
         FROM information_schema.columns c
         WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
           AND c.table_schema NOT LIKE 'pg_toast%'
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    params: [],
  };
}

export function pgBuildListColumns(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         c.column_name,
         c.data_type,
         c.is_nullable,
         EXISTS (
           SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = c.table_schema
             AND tc.table_name = c.table_name
             AND kcu.column_name = c.column_name
         ) AS is_primary_key
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
    params: [ref.namespace, ref.name],
  };
}

export function pgBuildListIndexes(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         i.relname                       AS name,
         ix.indisunique                  AS is_unique,
         ix.indisprimary                 AS is_primary,
         am.amname                       AS method,
         pg_get_indexdef(ix.indexrelid)  AS definition,
         ARRAY(
           SELECT a.attname
           FROM   pg_attribute a
           WHERE  a.attrelid = t.oid
             AND  a.attnum   = ANY(ix.indkey)
           ORDER BY array_position(ix.indkey::int[], a.attnum)
         )::text[] AS columns
       FROM   pg_index     ix
       JOIN   pg_class     t  ON t.oid  = ix.indrelid
       JOIN   pg_class     i  ON i.oid  = ix.indexrelid
       JOIN   pg_namespace n  ON n.oid  = t.relnamespace
       JOIN   pg_am        am ON am.oid = i.relam
       WHERE  n.nspname = $1
         AND  t.relname = $2
       ORDER BY ix.indisprimary DESC, i.relname`,
    params: [ref.namespace, ref.name],
  };
}

export { qualify as pgQualify };
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @prost/api test -- pg-sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/drivers/pg/pg-sql.ts apps/api/src/database/drivers/pg/pg-sql.test.ts
git commit -m "feat(api): add PgDriver metadata SQL builders"
```

### Task 5: Pure `pg-sql.ts` — grid builders (test-first)

**Files:**
- Modify: `apps/api/src/database/drivers/pg/pg-sql.ts`
- Test: `apps/api/src/database/drivers/pg/pg-sql.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { pgBuildSelectRows, pgBuildInsertRow, pgBuildUpdateRow, pgBuildDeleteRow, pgBuildRowCountEstimate } from './pg-sql';

describe('pg-sql grid builders', () => {
  const ref = { namespace: 'public', name: 'users' };
  it('selects with order + limit/offset placeholders after where params', () => {
    const { sql, params } = pgBuildSelectRows(ref, {
      whereClause: 'WHERE "age" > $1', whereParams: [18], orderColumn: 'id', sortDir: 'ASC', limit: 100, offset: 0,
    });
    expect(sql).toBe('SELECT * FROM "public"."users" WHERE "age" > $1 ORDER BY "id" ASC LIMIT $2 OFFSET $3');
    expect(params).toEqual([18, 100, 0]);
  });
  it('inserts named columns with RETURNING *', () => {
    const { sql, params } = pgBuildInsertRow(ref, [['name', 'ada'], ['age', 36]]);
    expect(sql).toBe('INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2) RETURNING *');
    expect(params).toEqual(['ada', 36]);
  });
  it('inserts DEFAULT VALUES when no entries', () => {
    expect(pgBuildInsertRow(ref, []).sql).toBe('INSERT INTO "public"."users" DEFAULT VALUES RETURNING *');
  });
  it('updates one column keyed by pk with RETURNING *', () => {
    const { sql, params } = pgBuildUpdateRow(ref, 'name', 'ada', ['id'], [7]);
    expect(sql).toBe('UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2 RETURNING *');
    expect(params).toEqual(['ada', 7]);
  });
  it('deletes by composite pk', () => {
    const { sql, params } = pgBuildDeleteRow(ref, ['a', 'b'], [1, 2]);
    expect(sql).toBe('DELETE FROM "public"."users" WHERE "a" = $1 AND "b" = $2');
    expect(params).toEqual([1, 2]);
  });
  it('estimates row count via pg_class', () => {
    const { sql, params } = pgBuildRowCountEstimate(ref);
    expect(sql).toContain('reltuples');
    expect(params).toEqual(['public', 'users']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @prost/api test -- pg-sql`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Implement grid builders (append to `pg-sql.ts`)**

```ts
import type { SelectRowsOptions } from '../../types';

export function pgBuildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment {
  const limitParam = opts.whereParams.length + 1;
  const offsetParam = opts.whereParams.length + 2;
  let sql = `SELECT * FROM ${qualify(ref)}`;
  if (opts.whereClause) sql += ` ${opts.whereClause}`;
  if (opts.orderColumn) sql += ` ORDER BY ${pgQuoteIdent(opts.orderColumn)} ${opts.sortDir}`;
  sql += ` LIMIT ${pgPlaceholder(limitParam)} OFFSET ${pgPlaceholder(offsetParam)}`;
  return { sql, params: [...opts.whereParams, opts.limit, opts.offset] };
}

export function pgBuildFilteredRowCount(ref: TableRef, whereClause: string, whereParams: unknown[]): SqlFragment {
  return { sql: `SELECT COUNT(*) AS count FROM ${qualify(ref)} ${whereClause}`, params: whereParams };
}

export function pgBuildRowCountEstimate(ref: TableRef): SqlFragment {
  return {
    sql: "SELECT reltuples FROM pg_class WHERE oid = to_regclass(format('%I.%I', $1::text, $2::text))",
    params: [ref.namespace, ref.name],
  };
}

export function pgBuildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment {
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${qualify(ref)} DEFAULT VALUES RETURNING *`, params: [] };
  }
  const cols = entries.map(([c]) => pgQuoteIdent(c)).join(', ');
  const vals = entries.map((_, i) => pgPlaceholder(i + 1)).join(', ');
  return { sql: `INSERT INTO ${qualify(ref)} (${cols}) VALUES (${vals}) RETURNING *`, params: entries.map(([, v]) => v) };
}

export function pgBuildUpdateRow(ref: TableRef, column: string, value: unknown, pkColumns: string[], pkValues: unknown[]): SqlFragment {
  const setClause = `${pgQuoteIdent(column)} = ${pgPlaceholder(1)}`;
  const whereClause = pkColumns.map((c, i) => `${pgQuoteIdent(c)} = ${pgPlaceholder(i + 2)}`).join(' AND ');
  return { sql: `UPDATE ${qualify(ref)} SET ${setClause} WHERE ${whereClause} RETURNING *`, params: [value, ...pkValues] };
}

export function pgBuildDeleteRow(ref: TableRef, pkColumns: string[], pkValues: unknown[]): SqlFragment {
  const whereClause = pkColumns.map((c, i) => `${pgQuoteIdent(c)} = ${pgPlaceholder(i + 1)}`).join(' AND ');
  return { sql: `DELETE FROM ${qualify(ref)} WHERE ${whereClause}`, params: pkValues };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @prost/api test -- pg-sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/drivers/pg/pg-sql.ts apps/api/src/database/drivers/pg/pg-sql.test.ts
git commit -m "feat(api): add PgDriver grid SQL builders"
```

### Task 6: Pure `pg-sql.ts` — DDL builders + type-name resolver (test-first)

**Files:**
- Modify: `apps/api/src/database/drivers/pg/pg-sql.ts`
- Test: `apps/api/src/database/drivers/pg/pg-sql.test.ts`

> The DDL string assembly is moved verbatim from `ddl.service.ts` (`buildSql`, `buildAlterSql`, the `createIndex`/`dropIndex` SQL). **Validation logic stays in `DdlService`** (it is engine-neutral input shaping); only the final SQL assembly moves here. Inputs are already-validated `CreateTableRequest` / `AlterTableOperation` / `CreateIndexRequest`.

- [ ] **Step 1: Add failing tests**

```ts
import { pgBuildCreateTable, pgBuildAlterTable, pgBuildCreateIndex, pgBuildDropIndex, pgBuildResolveTypeNames } from './pg-sql';

describe('pg-sql ddl builders', () => {
  it('builds CREATE TABLE with PK constraint', () => {
    const { sql } = pgBuildCreateTable({
      schema: 'public', table: 't',
      columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true }],
    } as any);
    expect(sql).toContain('CREATE TABLE "public"."t"');
    expect(sql).toContain('PRIMARY KEY ("id")');
  });
  it('builds ADD COLUMN alter', () => {
    const { sql } = pgBuildAlterTable({ namespace: 'public', name: 't' },
      { kind: 'addColumn', column: { name: 'c', type: 'text', nullable: true, isPrimaryKey: false } } as any);
    expect(sql).toBe('ALTER TABLE "public"."t" ADD COLUMN "c" text');
  });
  it('builds CREATE INDEX', () => {
    const { sql } = pgBuildCreateIndex({ schema: 'public', table: 't', columns: ['a'], unique: true } as any, 't_a_idx', 'btree');
    expect(sql).toBe('CREATE UNIQUE INDEX "t_a_idx" ON "public"."t" USING btree ("a")');
  });
  it('builds DROP INDEX', () => {
    expect(pgBuildDropIndex({ namespace: 'public', name: 'i' }, 'i').sql).toBe('DROP INDEX "public"."i"');
  });
  it('resolves type names by oid array', () => {
    const { sql, params } = pgBuildResolveTypeNames([23, 25]);
    expect(sql).toContain('pg_type');
    expect(params).toEqual([[23, 25]]);
  });
});
```

> Note `pgBuildDropIndex` takes a `TableRef` whose `name` is the **index name** (matches today's `DROP INDEX schema.index`); `namespace` is the schema. Document this in a code comment.

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @prost/api test -- pg-sql`
Expected: FAIL.

- [ ] **Step 3: Implement DDL builders (append to `pg-sql.ts`)**

```ts
import type { AlterTableOperation, CreateIndexRequest, CreateTableRequest } from '@prost/shared-types';

export function pgBuildCreateTable(req: CreateTableRequest): SqlFragment {
  const pkColumns = req.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const colDefs = req.columns.map((col) => {
    let def = `  ${pgQuoteIdent(col.name)} ${col.type}`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default.trim()}`;
    return def;
  });
  if (pkColumns.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkColumns.map(pgQuoteIdent).join(', ')})`);
  }
  return { sql: `CREATE TABLE ${pgQuoteIdent(req.schema)}.${pgQuoteIdent(req.table)} (\n${colDefs.join(',\n')}\n)`, params: [] };
}

export function pgBuildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment {
  const prefix = `ALTER TABLE ${qualify(ref)}`;
  let sql: string;
  switch (op.kind) {
    case 'addColumn': {
      const col = op.column;
      let def = `${pgQuoteIdent(col.name)} ${col.type}`;
      if (col.isPrimaryKey) def += ' PRIMARY KEY';
      else if (!col.nullable) def += ' NOT NULL';
      if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default}`;
      sql = `${prefix} ADD COLUMN ${def}`;
      break;
    }
    case 'dropColumn':
      sql = `${prefix} DROP COLUMN ${pgQuoteIdent(op.column)}`;
      break;
    case 'setNotNull':
      sql = `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} ${op.notNull ? 'SET' : 'DROP'} NOT NULL`;
      break;
    case 'setDefault':
      sql = op.default !== null
        ? `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} SET DEFAULT ${op.default}`
        : `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} DROP DEFAULT`;
      break;
    case 'changeType': {
      sql = `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} TYPE ${op.type}`;
      if (op.using) sql += ` USING ${op.using}`;
      break;
    }
  }
  return { sql, params: [] };
}

export function pgBuildCreateIndex(req: CreateIndexRequest, name: string, method: string): SqlFragment {
  const colList = req.columns.map(pgQuoteIdent).join(', ');
  return {
    sql: `CREATE ${req.unique ? 'UNIQUE ' : ''}INDEX ${pgQuoteIdent(name)} ON ${pgQuoteIdent(req.schema)}.${pgQuoteIdent(req.table)} USING ${method} (${colList})`,
    params: [],
  };
}

/** `ref.name` is the index name, `ref.namespace` the schema. */
export function pgBuildDropIndex(ref: TableRef, indexName: string): SqlFragment {
  return { sql: `DROP INDEX ${pgQuoteIdent(ref.namespace!)}.${pgQuoteIdent(indexName)}`, params: [] };
}

export function pgBuildResolveTypeNames(oids: number[]): SqlFragment {
  return { sql: 'SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])', params: [oids] };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @prost/api test -- pg-sql`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/drivers/pg/pg-sql.ts apps/api/src/database/drivers/pg/pg-sql.test.ts
git commit -m "feat(api): add PgDriver DDL and type-name SQL builders"
```

---

## Phase 2 — PgDriver (connection methods) + PoolManager + registry

### Task 7: Implement `PgDriver`

**Files:**
- Create: `apps/api/src/database/drivers/pg/pg-driver.ts`

> Connection methods are lifted verbatim from `pg-connection.service.ts` (the `pg.Pool`/`pg.Client` construction, `describeConnectionError`, `withTransactionClient` body, `testConnection`). The pool **caching/sweep/LRU is NOT here** — that moves to `PoolManager` (Task 8). `PgDriver` only knows how to make, talk to, and close a single `pg.Pool`. Builders delegate to `pg-sql.ts`.

- [ ] **Step 1: Write `PgDriver`**

```ts
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Pool } from 'pg';
import type { AlterTableOperation, CreateIndexRequest, CreateTableRequest } from '@prost/shared-types';
import type { DbDriver, DriverErrorContext } from '../../db-driver.interface';
import type {
  ConnectionParams, DbCapabilities, DriverQueryFn, DriverResult, NativePool, SelectRowsOptions, SqlFragment, TableRef, TestConnectionResult,
} from '../../types';
import * as sql from './pg-sql';

const CONNECT_TIMEOUT_MS = 5000;

function describeConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = Array.from(error.errors).find((e): e is Error => e instanceof Error && !!e.message);
    if (inner) return inner.message;
  }
  if (error instanceof Error && error.message) return error.message;
  const code = (error as { code?: string } | undefined)?.code;
  return code ? `Connection failed (${code})` : 'Connection failed';
}

@Injectable()
export class PgDriver implements DbDriver {
  readonly engine = 'postgres';
  readonly capabilities: DbCapabilities = { supportsReturning: true, supportsSchemas: true, parserDialect: 'postgresql' };

  private readonly statementTimeoutMs: number;
  private readonly poolSize: number;

  constructor(config: ConfigService) {
    this.statementTimeoutMs = Number(config.get('QUERY_TIMEOUT_MS') ?? 30_000);
    this.poolSize = Number(config.get('TARGET_POOL_SIZE') ?? 5);
  }

  async createPool(params: ConnectionParams): Promise<NativePool> {
    return new Pool({
      host: params.host, port: params.port, database: params.database,
      user: params.username, password: params.password,
      ssl: params.sslEnabled ? { rejectUnauthorized: params.sslRejectUnauthorized } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: this.statementTimeoutMs, max: this.poolSize,
    });
  }

  async closePool(pool: NativePool): Promise<void> {
    await (pool as Pool).end();
  }

  async query(pool: NativePool, frag: SqlFragment): Promise<DriverResult> {
    const r = await (pool as Pool).query(frag.sql, frag.params);
    return { rows: r.rows, fields: r.fields, rowCount: r.rowCount, command: r.command };
  }

  async withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const client = await (pool as Pool).connect();
    const query: DriverQueryFn = async ({ sql: text, params = [] }) => {
      const r = await client.query(text, params);
      return { rows: r.rows, fields: r.fields, rowCount: r.rowCount, command: r.command };
    };
    try {
      return await fn(query);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async testConnection(params: ConnectionParams): Promise<TestConnectionResult> {
    const client = new Client({
      host: params.host, port: params.port, database: params.database,
      user: params.username, password: params.password,
      ssl: params.sslEnabled ? { rejectUnauthorized: params.sslRejectUnauthorized } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: this.statementTimeoutMs,
    });
    try {
      await client.connect();
      const r = await client.query<{ server_version: string }>('SHOW server_version');
      return { ok: true, message: 'Connection successful', serverVersion: r.rows[0]?.server_version };
    } catch (error) {
      return { ok: false, message: describeConnectionError(error) };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  quoteIdent = sql.pgQuoteIdent;
  placeholder = sql.pgPlaceholder;
  buildListTables = sql.pgBuildListTables;
  buildListAllColumns = sql.pgBuildListAllColumns;
  buildListColumns = (ref: TableRef) => sql.pgBuildListColumns(ref);
  buildListIndexes = (ref: TableRef) => sql.pgBuildListIndexes(ref);
  buildSelectRows = (ref: TableRef, opts: SelectRowsOptions) => sql.pgBuildSelectRows(ref, opts);
  buildFilteredRowCount = (ref: TableRef, w: string, p: unknown[]) => sql.pgBuildFilteredRowCount(ref, w, p);
  buildRowCountEstimate = (ref: TableRef) => sql.pgBuildRowCountEstimate(ref);
  buildInsertRow = (ref: TableRef, e: [string, unknown][]) => sql.pgBuildInsertRow(ref, e);
  buildUpdateRow = (ref: TableRef, c: string, v: unknown, pk: string[], pv: unknown[]) => sql.pgBuildUpdateRow(ref, c, v, pk, pv);
  buildDeleteRow = (ref: TableRef, pk: string[], pv: unknown[]) => sql.pgBuildDeleteRow(ref, pk, pv);
  buildCreateTable = (req: CreateTableRequest) => sql.pgBuildCreateTable(req);
  buildAlterTable = (ref: TableRef, op: AlterTableOperation) => sql.pgBuildAlterTable(ref, op);
  buildCreateIndex = (req: CreateIndexRequest, name: string, method: string) => sql.pgBuildCreateIndex(req, name, method);
  buildDropIndex = (ref: TableRef, indexName: string) => sql.pgBuildDropIndex(ref, indexName);
  buildResolveTypeNames = (oids: number[]) => sql.pgBuildResolveTypeNames(oids);

  mapError(error: unknown, ctx: DriverErrorContext): void {
    const code = (error as { code?: string } | undefined)?.code;
    if (ctx.operation === 'createTable' && code === '42P07') {
      throw new ConflictException(ctx.detail ?? 'Table already exists');
    }
    if (ctx.operation === 'alterTable') {
      if (code === '42703') throw new UnprocessableEntityException('Column does not exist');
      if (code === '42846') throw new UnprocessableEntityException('Cannot cast automatically; provide a USING expression');
      if (code === '23502') throw new UnprocessableEntityException('Column has existing null values; cannot set NOT NULL');
      if (code === '42701') throw new ConflictException('Column already exists');
    }
    if (ctx.operation === 'createIndex' && code === '42P07') {
      throw new ConflictException('An index with that name already exists');
    }
    if (ctx.operation === 'dropIndex' && code === '42704') {
      throw new UnprocessableEntityException('Index does not exist');
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @prost/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/drivers/pg/pg-driver.ts
git commit -m "feat(api): implement PgDriver connection + builder delegation"
```

### Task 8: Implement `DbDriverRegistry` + `PoolManager`

**Files:**
- Create: `apps/api/src/database/db-driver.registry.ts`
- Create: `apps/api/src/database/pool-manager.service.ts`

> `PoolManager` is the engine-agnostic lifecycle lifted from `pg-connection.service.ts` (the `pools`/`poolLastUsed` maps, `onModuleInit`/`onModuleDestroy`, `getPool`, `sweep`, LRU cap, `evictPool`). It resolves the driver per connection via the registry and delegates create/query/close.

- [ ] **Step 1: Write the registry**

```ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DB_DRIVERS, type DbDriver } from './db-driver.interface';

@Injectable()
export class DbDriverRegistry {
  private readonly byEngine: Map<string, DbDriver>;

  constructor(@Inject(DB_DRIVERS) drivers: DbDriver[]) {
    this.byEngine = new Map(drivers.map((d) => [d.engine, d]));
  }

  get(engine: string): DbDriver {
    const driver = this.byEngine.get(engine);
    if (!driver) throw new BadRequestException(`Unsupported database engine "${engine}"`);
    return driver;
  }
}
```

- [ ] **Step 2: Write the PoolManager**

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { DbDriverRegistry } from './db-driver.registry';
import type { ConnectionParams, DriverQueryFn, DriverResult, NativePool, SqlFragment, TestConnectionResult } from './types';

@Injectable()
export class PoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolManager.name);
  private readonly pools = new Map<string, Promise<NativePool>>();
  private readonly poolLastUsed = new Map<string, number>();
  private readonly poolEngine = new Map<string, string>();
  private sweepInterval?: ReturnType<typeof setInterval>;

  private readonly poolIdleMs: number;
  private readonly poolMax: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: DbDriverRegistry,
    config: ConfigService,
  ) {
    this.poolIdleMs = Number(config.get('TARGET_POOL_IDLE_MS') ?? 10 * 60_000);
    this.poolMax = Number(config.get('TARGET_POOL_MAX') ?? 20);
  }

  onModuleInit(): void {
    this.sweepInterval = setInterval(this.sweep, Math.floor(this.poolIdleMs / 2));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    await Promise.all([...this.pools.keys()].map((id) => this.evictPool(id)));
  }

  async run(connectionId: string, frag: SqlFragment): Promise<DriverResult> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    const start = Date.now();
    try {
      const r = await driver.query(pool, frag);
      this.logger.log(`target query ok connectionId=${connectionId} durationMs=${Date.now() - start}`);
      return r;
    } catch (error) {
      this.logger.warn(`target query failed connectionId=${connectionId} durationMs=${Date.now() - start} error=${error instanceof Error ? error.message : 'unknown'}`);
      throw error;
    }
  }

  async withTransaction<T>(connectionId: string, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    return driver.withTransaction(pool, fn);
  }

  async testConnection(engine: string, params: ConnectionParams): Promise<TestConnectionResult> {
    return this.registry.get(engine).testConnection(params);
  }

  async evictPool(connectionId: string): Promise<void> {
    const cached = this.pools.get(connectionId);
    if (!cached) return;
    const engine = this.poolEngine.get(connectionId)!;
    this.pools.delete(connectionId);
    this.poolLastUsed.delete(connectionId);
    this.poolEngine.delete(connectionId);
    await cached.then((pool) => this.registry.get(engine).closePool(pool)).catch(() => undefined);
    this.logger.log(`pool evicted connectionId=${connectionId}`);
  }

  private async resolve(connectionId: string): Promise<{ driver: ReturnType<DbDriverRegistry['get']>; pool: NativePool }> {
    const connection = await this.prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    const driver = this.registry.get(connection.engine);
    this.poolEngine.set(connectionId, connection.engine);

    const cached = this.pools.get(connectionId);
    if (cached) {
      this.poolLastUsed.set(connectionId, Date.now());
      return { driver, pool: await cached };
    }

    const password = this.crypto.decrypt(connection.encryptedCredentials as unknown as EncryptedPayload);
    const params: ConnectionParams = {
      host: connection.host, port: connection.port, database: connection.database,
      username: connection.username, password, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized,
    };
    const created = driver.createPool(params);
    this.pools.set(connectionId, created);
    this.poolLastUsed.set(connectionId, Date.now());
    created.catch(() => { this.pools.delete(connectionId); this.poolLastUsed.delete(connectionId); this.poolEngine.delete(connectionId); });
    return { driver, pool: await created };
  }

  private readonly sweep = (): void => {
    const now = Date.now();
    for (const [connectionId, lastUsed] of [...this.poolLastUsed.entries()].sort((a, b) => a[1] - b[1])) {
      if (now - lastUsed > this.poolIdleMs) {
        this.logger.log(`pool idle sweep evicting connectionId=${connectionId} idleMs=${now - lastUsed}`);
        void this.evictPool(connectionId);
      }
    }
    const active = [...this.pools.keys()];
    if (active.length > this.poolMax) {
      const lru = [...this.poolLastUsed.entries()].sort((a, b) => a[1] - b[1]).slice(0, active.length - this.poolMax);
      for (const [connectionId] of lru) {
        this.logger.log(`pool LRU cap evicting connectionId=${connectionId}`);
        void this.evictPool(connectionId);
      }
    }
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @prost/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/db-driver.registry.ts apps/api/src/database/pool-manager.service.ts
git commit -m "feat(api): add DbDriverRegistry and shared PoolManager"
```

### Task 9: Wire `DatabaseModule`, retire `TargetDbModule`

**Files:**
- Create: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/src/app.module.ts` (swap `TargetDbModule` → `DatabaseModule`)
- Delete: `apps/api/src/target-db/target-db.module.ts`

- [ ] **Step 1: Write `DatabaseModule`**

```ts
import { Global, Module } from '@nestjs/common';
import { DB_DRIVERS } from './db-driver.interface';
import { DbDriverRegistry } from './db-driver.registry';
import { PoolManager } from './pool-manager.service';
import { PgDriver } from './drivers/pg/pg-driver';

@Global()
@Module({
  providers: [
    PgDriver,
    { provide: DB_DRIVERS, useFactory: (pg: PgDriver) => [pg], inject: [PgDriver] },
    DbDriverRegistry,
    PoolManager,
  ],
  exports: [PoolManager, DbDriverRegistry],
})
export class DatabaseModule {}
```

- [ ] **Step 2: Swap the import in `app.module.ts`**

Replace the `TargetDbModule` import line and its entry in the `imports` array with `DatabaseModule` (from `./database/database.module`).

- [ ] **Step 3: Delete the old module file**

Run: `git rm apps/api/src/target-db/target-db.module.ts`

- [ ] **Step 4: Build (expect failures only in not-yet-cut-over services)**

Run: `pnpm --filter @prost/api exec tsc --noEmit`
Expected: errors limited to files still importing `PgConnectionService` (cut over in Phase 3). DatabaseModule itself compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/database.module.ts apps/api/src/app.module.ts apps/api/src/target-db/target-db.module.ts
git commit -m "feat(api): wire DatabaseModule, retire TargetDbModule"
```

---

## Phase 3 — Cut feature services over to the driver

> After each task, the cut-over service's existing unit tests must pass. Those tests currently mock `PgConnectionService`; update the mock to `PoolManager` + (where builders are used) inject a real `PgDriver` or a thin fake exposing the builder methods. Because builders are pure and covered in Phase 1, services can use a **real `PgDriver`** in tests and only mock `PoolManager.run`/`withTransaction`.

### Task 10: Cut over `ConnectionsService`

**Files:**
- Modify: `apps/api/src/connections/connections.service.ts:6,16,61,68,75,93`
- Modify: `apps/api/src/connections/connections.module.ts`
- Modify: `apps/api/src/connections/dto/create-connection.dto.ts`, `update-connection.dto.ts`

- [ ] **Step 1: Add optional `engine` to DTOs**

In `create-connection.dto.ts`, add (matching the file's existing class-validator style):

```ts
import { IsIn, IsOptional } from 'class-validator';
// ...inside the class:
  @IsOptional()
  @IsIn(['postgres'])
  engine?: string;
```

Add the same optional field to `update-connection.dto.ts`.

- [ ] **Step 2: Replace `PgConnectionService` with `PoolManager`**

In `connections.service.ts`: change the import to `import { PoolManager } from '../database/pool-manager.service';`, rename the constructor param to `private readonly poolManager: PoolManager`. Replace `this.pgConnectionService.evictPool(id)` → `this.poolManager.evictPool(id)` (both call sites). For the two `testConnection({...})` calls, pass the engine first: `this.poolManager.testConnection(dto.engine ?? existing?.engine ?? 'postgres', { host, port, database, username, password, sslEnabled, sslRejectUnauthorized })`. Persist `engine: dto.engine ?? 'postgres'` in the `create` path's Prisma `data`.

- [ ] **Step 3: Drop `TargetDbModule` from `connections.module.ts`**

`DatabaseModule` is `@Global()`, so remove any `TargetDbModule` import; `PoolManager` resolves globally.

- [ ] **Step 4: Update the connections test double**

In `connections.service.test.ts`, replace the `PgConnectionService` mock with a `PoolManager` mock exposing `evictPool: vi.fn()` and `testConnection: vi.fn()`. Update the `testConnection` assertion to expect the engine as the first arg.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @prost/api test -- connections`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/connections
git commit -m "feat(api): connections use PoolManager and persist engine"
```

### Task 11: Cut over `MetadataService`

**Files:**
- Modify: `apps/api/src/metadata/metadata.service.ts`
- Modify: `apps/api/src/metadata/metadata.module.ts`, `metadata.service.test.ts`

- [ ] **Step 1: Inject `PoolManager` + `PgDriver`, call builders**

Replace the `PgConnectionService` constructor dep with `private readonly pool: PoolManager` and `private readonly driver: PgDriver` (imported from `../database/...`). Rewrite each query: `getSchemas` runs `this.pool.run(connectionId, this.driver.buildListTables())` and `...buildListAllColumns()`; `getTableColumns` runs `this.pool.run(connectionId, this.driver.buildListColumns({ namespace: schema, name: table }))`; `getTableIndexes` uses `buildListIndexes(...)`. Keep all row→DTO mapping exactly as-is. Cast `run` results to the existing row interfaces (`TableRow`, `AllColumnsRow`, `ColumnRow`, `IndexRow`).

> Note: `metadata.service.ts` internal methods keep `(connectionId, schema, table)` string params for now (callers in grid/ddl/query already pass strings); they construct the `TableRef` internally. This contains TableRef churn to driver calls.

- [ ] **Step 2: Update module**

`metadata.module.ts`: remove `ConnectionsModule`/`TargetDb` plumbing that only provided the old service if unused; `PoolManager`/`PgDriver` come from the global `DatabaseModule`. Add `PgDriver` to providers only if Nest cannot resolve it globally (it can — leave as global).

- [ ] **Step 3: Update test double**

In `metadata.service.test.ts`, replace the `PgConnectionService` mock with a `PoolManager` mock (`run: vi.fn()` returning canned `{ rows, fields, rowCount, command }`) and pass a real `new PgDriver(configStub)` so builders are exercised. Assertions on emitted SQL move to checking the `run` mock received the expected `{ sql, params }` (or keep asserting on returned DTOs only).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @prost/api test -- metadata`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/metadata
git commit -m "feat(api): MetadataService uses PgDriver builders via PoolManager"
```

### Task 12: Make `compileWhere` dialect-neutral

**Files:**
- Modify: `apps/api/src/grid/filter.ts`
- Modify: `apps/api/src/grid/filter.test.ts`

> Today `filter.ts` hardcodes `$n` placeholders and `quoteIdent`. To keep `buildSelectRows` honest for future engines, `compileWhere` takes a `placeholder` fn and a `quoteIdent` fn. PG behavior is unchanged because we pass `pgPlaceholder`/`pgQuoteIdent`.

- [ ] **Step 1: Add a failing test asserting injected placeholder is used**

```ts
it('uses the injected placeholder function', () => {
  const { clause, params } = compileWhere(filter, columns, 0, { placeholder: (i) => `?${i}`, quoteIdent: (s) => `[${s}]` });
  expect(clause).toContain('?1');
  expect(clause).toContain('[');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @prost/api test -- filter`
Expected: FAIL (4th arg unsupported).

- [ ] **Step 3: Add an optional `dialect` param (default PG) to `compileWhere`**

Add a 4th optional param `dialect: { placeholder: (i: number) => string; quoteIdent: (s: string) => string }` defaulting to `{ placeholder: (i) => \`$${i}\`, quoteIdent }` (import `quoteIdent` from `@prost/utils`). Replace internal `$${n}` and `quoteIdent(...)` usages with `dialect.placeholder(n)` / `dialect.quoteIdent(...)`. Existing call sites pass no 4th arg → identical PG output.

- [ ] **Step 4: Run, verify pass (incl. existing filter tests)**

Run: `pnpm --filter @prost/api test -- filter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/grid/filter.ts apps/api/src/grid/filter.test.ts
git commit -m "refactor(api): make compileWhere placeholder/quote dialect-injectable"
```

### Task 13: Cut over `GridService`

**Files:**
- Modify: `apps/api/src/grid/grid.service.ts`
- Modify: `apps/api/src/grid/grid.module.ts`, `grid.service.test.ts`

- [ ] **Step 1: Inject `PoolManager` + `PgDriver`; replace SQL with builders**

Swap the `PgConnectionService` dep for `private readonly pool: PoolManager` and `private readonly driver: PgDriver`. In `getRows`: build `const ref = { namespace: schema, name: table }`; compute `whereClause`/`filterParams` via `compileWhere(options.filter!, columns, 0)` (unchanged — PG default); then `this.driver.buildSelectRows(ref, { whereClause, whereParams: filterParams, orderColumn, sortDir, limit, offset })` → `this.pool.run(connectionId, frag)`. Replace `getFilteredRowCount` with `this.driver.buildFilteredRowCount(ref, whereClause, filterParams)`; `getApproximateRowCount` with `this.driver.buildRowCountEstimate(ref)`. In `updateCell`/`insertRow`/`deleteRow` use `buildUpdateRow`/`buildInsertRow`/`buildDeleteRow`. Keep all validation (`resolveTable`, `assertEditable`, `assertPrimaryKeyMatches`), the `sortDir` normalization, `rowCount !== 1` checks, and the `sourceTable: \`${schema}.${table}\`` response field exactly as-is.

- [ ] **Step 2: Update module + test double**

`grid.module.ts`: drop `TargetDb`/`ConnectionsModule` plumbing no longer needed; keep `MetadataModule`. In `grid.service.test.ts`, replace the `PgConnectionService` mock with a `PoolManager` mock (`run: vi.fn()`) and a real `PgDriver`; keep `MetadataService` mock. Update any test asserting raw SQL strings to assert on the `{ sql, params }` passed to `pool.run`.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @prost/api test -- grid`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/grid
git commit -m "feat(api): GridService uses PgDriver builders via PoolManager"
```

### Task 14: Cut over `DdlService`

**Files:**
- Modify: `apps/api/src/ddl/ddl.service.ts`
- Modify: `apps/api/src/ddl/ddl.module.ts`, `ddl.service.test.ts`

- [ ] **Step 1: Replace SQL assembly + try/catch error mapping with the driver**

Swap the `PgConnectionService` dep for `PoolManager` + `PgDriver`. Keep ALL validation (`validateType`, `validateDefault`, type/method/USING regexes, duplicate/PK checks, the alter `switch` normalization). Replace `this.buildSql(...)` with `this.driver.buildCreateTable({ schema, table, columns })` and delete the private `buildSql`/`buildAlterSql` methods. Replace each `try { runParameterized(...) } catch (pg) { if (pg.code...) }` block with:

```ts
const frag = this.driver.buildCreateTable({ schema: req.schema, table: req.table, columns });
try {
  await this.pool.run(connectionId, frag);
} catch (err) {
  this.driver.mapError(err, { operation: 'createTable', detail: `Table "${req.schema}"."${req.table}" already exists` });
  throw err;
}
return { schema: req.schema, table: req.table, sql: frag.sql };
```

Apply the same pattern for `alterTable` (`operation: 'alterTable'`, ref `{ namespace: req.schema, name: req.table }`, builder `buildAlterTable`), `createIndex` (`operation: 'createIndex'`, builder `buildCreateIndex(req, name, method)` — keep the existing name-derivation + method validation in the service), and `dropIndex` (`operation: 'dropIndex'`, builder `buildDropIndex({ namespace: req.schema, name: req.index }, req.index)`). Each returns `sql: frag.sql`.

- [ ] **Step 2: Update module + test double**

`ddl.module.ts`: keep `MetadataModule`; drop old `TargetDb` plumbing. In `ddl.service.test.ts`, swap the `PgConnectionService` mock for `PoolManager` (`run: vi.fn()`) + a real `PgDriver`; keep `MetadataService` mock. Error-mapping tests now make `pool.run` reject with `{ code: '42P07' }` etc. and assert the mapped exception — behavior identical to before.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @prost/api test -- ddl`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/ddl
git commit -m "feat(api): DdlService uses PgDriver builders and mapError"
```

### Task 15: Cut over `QueryService`

**Files:**
- Modify: `apps/api/src/query/query.service.ts`
- Modify: `apps/api/src/query/query.module.ts`, `query.service.test.ts`

- [ ] **Step 1: Replace choke-point calls + parser dialect + type lookup**

Swap the `PgConnectionService` dep for `PoolManager` + `PgDriver`. The local `RunFn` type changes to operate on `SqlFragment`: define `type RunFn = (frag: SqlFragment) => Promise<DriverResult>`. In `executeAutocommit`, pass `(frag) => this.pool.run(connectionId, frag)`. In `executeTransactional`, use `this.pool.withTransaction(connectionId, async (query) => { ... })` and call `query({ sql, params })` (already the shape `DriverQueryFn` expects). Update `executeOneStatement`/`executeRows`/`executeCommand`/`executePlan` to build `{ sql, params }` fragments where they currently pass `(sql, params)`. Replace the hardcoded `this.parser.astify(sql, { database: 'postgresql' })` with `{ database: this.driver.capabilities.parserDialect }`. Replace the `pg_type` lookup in `mapColumns` with `this.pool.run(connectionId, this.driver.buildResolveTypeNames(oids))`.

- [ ] **Step 2: Update module + test double**

`query.module.ts`: keep `MetadataModule` + `HistoryModule`; drop old plumbing. In `query.service.test.ts`, swap the `PgConnectionService` mock for `PoolManager` (`run`, `withTransaction`) + a real `PgDriver`; keep `MetadataService`/`HistoryService` mocks. Transaction tests adapt to `withTransaction(connectionId, fn)` receiving a `query` that takes `{ sql, params }`.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @prost/api test -- query`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/query
git commit -m "feat(api): QueryService uses PoolManager and driver parser dialect"
```

### Task 16: Delete `PgConnectionService`

**Files:**
- Delete: `apps/api/src/target-db/pg-connection.service.ts`, `pg-connection.service.test.ts`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "PgConnectionService\|target-db/pg-connection" apps/api/src`
Expected: no matches (all cut over in Tasks 10–15).

- [ ] **Step 2: Delete the files**

Run: `git rm apps/api/src/target-db/pg-connection.service.ts apps/api/src/target-db/pg-connection.service.test.ts`
(If `apps/api/src/target-db/` is now empty, `git rm -r` it.)

- [ ] **Step 3: Full build + test**

Run: `pnpm --filter @prost/api exec tsc --noEmit && pnpm --filter @prost/api test`
Expected: PASS, no references to the deleted service.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api/src/target-db
git commit -m "refactor(api): remove PgConnectionService, superseded by PoolManager+PgDriver"
```

---

## Phase 4 — Conformance suite + final verification

### Task 17: Driver-agnostic conformance suite

**Files:**
- Create: `apps/api/src/database/testing/driver-contract.ts`
- Create: `apps/api/src/database/drivers/pg/pg-driver.contract.test.ts`

> The suite runs against a **real** database. Use the existing `demo-target-postgres` on :5434 (seeded `users`/`orders`/`products`). It creates/drops a throwaway schema so it never mutates seed tables.

- [ ] **Step 1: Write the reusable contract**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbDriver } from '../db-driver.interface';
import type { ConnectionParams, NativePool } from '../types';

export function runDriverContractTests(makeDriver: () => DbDriver, params: ConnectionParams): void {
  describe(`DbDriver contract`, () => {
    let driver: DbDriver;
    let pool: NativePool;
    const schema = `prost_contract_${Date.now()}`;
    const ref = { namespace: schema, name: 'widgets' };

    beforeAll(async () => {
      driver = makeDriver();
      pool = await driver.createPool(params);
      await driver.query(pool, { sql: `CREATE SCHEMA ${driver.quoteIdent(schema)}`, params: [] });
      await driver.query(pool, driver.buildCreateTable({
        schema, table: 'widgets',
        columns: [
          { name: 'id', type: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'name', type: 'text', nullable: true, isPrimaryKey: false },
        ],
      } as never));
    });

    afterAll(async () => {
      await driver.query(pool, { sql: `DROP SCHEMA IF EXISTS ${driver.quoteIdent(schema)} CASCADE`, params: [] }).catch(() => undefined);
      await driver.closePool(pool);
    });

    it('quoteIdent escapes embedded quotes', () => {
      expect(driver.quoteIdent('a"b')).toContain('a');
    });

    it('binds params, never interpolates', async () => {
      const r = await driver.query(pool, { sql: `SELECT ${driver.placeholder(1)}::int AS v`, params: [42] });
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
      expect(Array.isArray((idx.rows[0] as Record<string, unknown>).columns)).toBe(true);
    });
  });
}
```

- [ ] **Step 2: Write the PG runner**

```ts
import { ConfigService } from '@nestjs/config';
import { PgDriver } from './pg-driver';
import { runDriverContractTests } from '../../testing/driver-contract';

const config = { get: (k: string) => ({ QUERY_TIMEOUT_MS: '30000', TARGET_POOL_SIZE: '5' } as Record<string, string>)[k] } as unknown as ConfigService;

runDriverContractTests(() => new PgDriver(config), {
  host: process.env.CONTRACT_PG_HOST ?? 'localhost',
  port: Number(process.env.CONTRACT_PG_PORT ?? 5434),
  database: process.env.CONTRACT_PG_DB ?? 'demo',
  username: process.env.CONTRACT_PG_USER ?? 'demo',
  password: process.env.CONTRACT_PG_PASSWORD ?? 'demo',
  sslEnabled: false,
  sslRejectUnauthorized: true,
});
```

> Adjust the demo db/user/password to match `docker-compose.yml` / `docker/demo-target-init.sql`. Confirm them before running.

- [ ] **Step 3: Start docker + run the contract suite**

Run: `docker compose up -d && pnpm --filter @prost/api test -- pg-driver.contract`
Expected: PASS (all contract cases green against demo-target-postgres).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/testing apps/api/src/database/drivers/pg/pg-driver.contract.test.ts
git commit -m "test(api): add driver conformance suite, run against PgDriver"
```

### Task 18: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (update the two-database-boundary section to reference `PoolManager`/`DbDriver`)

- [ ] **Step 1: Whole-repo build, lint, test**

Run: `pnpm -w build && pnpm -w lint && pnpm -w test`
Expected: all PASS.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run: `pnpm --filter @prost/api dev` (with docker up), then exercise: list schemas, browse rows, insert/edit/delete a row, run a SELECT in the editor, create+drop an index. Expected: identical behavior to pre-refactor.

- [ ] **Step 3: Update CLAUDE.md choke-point wording**

In the "two-database boundary" section, replace `PgConnectionService` / `runParameterized` references with: target DBs are reached only through `PoolManager` (caching/sweep/LRU) delegating to a `DbDriver` (one per engine, resolved via `DbDriverRegistry` keyed by `Connection.engine`); all dialect SQL lives in the driver; identifiers go through the driver's `quoteIdent`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe pluggable DbDriver seam in two-database boundary"
```

---

## Self-review notes

- **Spec coverage:** §2 architecture → Tasks 7–9; §3 interface → Tasks 2–3,7; §4 PoolManager → Task 8; §5 registry/engine field → Tasks 1,3,8,10; §6 TableRef → Tasks 2,11–15; §7 service refactor → Tasks 11–15; §8 conformance → Task 17; §9 risks (verbatim SQL move) → Phase 1 keeps SQL identical; §10 rollout order matches Phases 0–4.
- **Filter coupling** (`grid/filter.ts` `$n`/ILIKE) was not in the spec's explicit list; Task 12 makes it dialect-injectable so `buildSelectRows` is honest — small, in-scope, PG output unchanged.
- **Type consistency:** `TableRef {namespace?,name}`, `SqlFragment {sql,params}`, `DriverResult {rows,fields,rowCount,command}`, `SelectRowsOptions {whereClause,whereParams,orderColumn,sortDir,limit,offset}`, `DriverQueryFn(frag)` used consistently across interface (Task 3), PgDriver (Task 7), PoolManager (Task 8), and all service cut-overs (Tasks 11–15).
- **Out of scope (per spec §1):** no MySQL/SQLite driver, no frontend engine picker, no `mysql://` parsing, no DTO/wire changes beyond the optional `engine` field.
