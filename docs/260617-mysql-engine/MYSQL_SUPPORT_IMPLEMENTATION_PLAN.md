# MySQL 8.0+ Full-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MySQL 8.0+ as a first-class target database with the same user-facing capabilities as PostgreSQL.

**Architecture:** Extend the existing pluggable `DbDriver` seam with registry-backed engine
descriptors. The seam already absorbs Postgres and SQLite (both `RETURNING`-capable) via pure
`{ sql, params }` builders. MySQL exposes exactly one gap: with no `RETURNING`, insert/update
cannot return the persisted row in one statement. Close that gap narrowly by **promoting
insert and update from pure fragment builders to executing driver methods** that take a
transactional `DriverQueryFn` and return the row. PG/SQLite implement them as one `RETURNING`
query; MySQL runs `INSERT`/`UPDATE` then re-selects by the derived primary key — atomic because
the grid runs them through `PoolManager.withTransaction`. Note today's `withTransaction` only
*pins* a connection (the editor adds its own `BEGIN`/`COMMIT`), so this plan splits it: `withSession`
(pin only, keeps the editor's semantics) and a real `withTransaction` (auto `BEGIN`/`COMMIT`/`ROLLBACK`,
used by the grid). No generic operation-plan/workflow type is introduced: the only cross-engine
variation is "return-the-row in one statement vs. two," a per-operation method, not an N-step plan.

**Tech Stack:** NestJS 11, TypeScript, `mysql2/promise`, Prisma, React 19, Vitest, `node-sql-parser`, `sql-formatter`, Docker MySQL 8.0, GitHub Actions.

**Related plan:** `PLUGGABLE_DB_DRIVER_SEAM_PLAN.md`

---

## Scope and decisions

- Support MySQL 8.0 and newer. MariaDB compatibility is out of scope.
- Ship full parity in one feature: connection management, metadata browsing, grid CRUD/filtering, DDL, SQL execution, transactions, EXPLAIN, AI prompting, URI import, Docker, and CI.
- Browse only the connected database. A MySQL connection's `database` field is the single
  namespace shown in the schema tree — sibling databases on the server are hidden even when the
  user has grants. This matches the Postgres single-database mental model and is the tightest read
  surface. (Decided; see "MySQL namespace scope" below.)
- Preserve the full-row response after successful grid inserts and updates.
- Reject an insert before mutation when its resulting primary key cannot be derived reliably.
- Model `AUTO_INCREMENT` as an explicit engine-neutral column property.
- Expose registered engine metadata through an API instead of adding scattered frontend engine branches.
- A saved connection's engine is immutable.
- Split the two connection-pinning semantics (today's `withTransaction` only pins a connection;
  it does **not** issue `BEGIN` — the editor adds its own `BEGIN`/`COMMIT`/`ROLLBACK` statements):
  - `PoolManager.withSession(connectionId, fn)` — one pinned connection, **no** automatic
    transaction. `QueryService` uses this and keeps emitting its own `BEGIN`/`COMMIT`/`ROLLBACK`
    batch statements (portable to MySQL), so its reported statement count, COMMIT result row, and
    error attribution stay unchanged for Postgres.
  - `PoolManager.withTransaction(connectionId, fn)` — one pinned connection that the driver
    **automatically** wraps in `BEGIN` … `COMMIT`, rolling back on any throw. Grid insert/update
    use this so the MySQL `INSERT` + re-`SELECT` are genuinely atomic (without it the `INSERT`
    autocommits and a failed re-select orphans a row).
- Do **not** add a generic `DriverOperation`/`executePlan` abstraction — insert and update become
  two executing driver methods (`insertRow`/`updateRow`) that take a `DriverQueryFn`.
- Reject MariaDB and pre-8.0 explicitly at **both** `testConnection` **and** pool initialization
  (a saved connection can be used without ever pressing "Test"): inspect `SELECT VERSION()` and
  fail if it contains `MariaDB` or major version `< 8`.
- MySQL insert row-derivation is **narrow and deterministic** (no value-matching fallback, which
  cannot establish uniqueness from column metadata and races under concurrency). Support exactly:
  1. a complete supplied primary key → re-select by it;
  2. a primary key missing exactly one `AUTO_INCREMENT` component → resolve that component from
     `insertId`, re-select by the full key.
  Reject every other case (no PK, multiple missing components, generated/UUID/trigger PKs,
  default-only inserts) with 422 **before** executing the `INSERT`.

**Decided — MySQL namespace scope:** browse the **connected database only**. A MySQL connection
can technically see every database it has grants on, which would be a broader read surface than
Postgres (where a connection sees only its one database's schemas). To keep parity and the
tightest surface, MySQL metadata builders filter every query to the connection's `database`; the
schema tree shows that single namespace. No system-database exclusion list is needed — filtering
to one database already excludes `information_schema`/`mysql`/`performance_schema`/`sys`.

## Public interface changes

### Shared types

Extend `packages/shared-types/src/connection.ts`:

```ts
export type DbEngine = 'postgres' | 'mysql' | 'sqlite';

export interface DbEngineDescriptor {
  engine: DbEngine;
  label: string;
  connectionMode: 'network' | 'file';
  defaultPort?: number;
  uriSchemes: string[];
  parserDialect: 'postgresql' | 'mysql' | 'sqlite';
  formatterDialect: 'postgresql' | 'mysql' | 'sqlite';
  namespaceLabel: string;
  defaultNamespace?: string;
  supportsSsl: boolean;
  sslEnabledByDefault: boolean;
  ddl: {
    columnTypes: string[];
    defaultExamples: string[];
    indexMethods: string[];
    supportsAutoIncrement: boolean;
    supportsUsingExpression: boolean;
  };
}
```

Per-engine descriptor values worth pinning now: MySQL `ddl.indexMethods = ['btree']` (InnoDB
ignores `USING HASH`), `supportsAutoIncrement: true`, `supportsUsingExpression: false`,
`namespaceLabel: 'Database'`. `defaultNamespace` is `'public'` for Postgres and **undefined** for
MySQL — MySQL's effective default namespace is the connection's database, resolved at runtime (a
static descriptor can't hold a per-connection value), so unqualified-table resolution reads the
connection database, not this field.

Extend `packages/shared-types/src/metadata.ts`:

```ts
export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string | null;
}
```

Extend `NewColumn` in `packages/shared-types/src/ddl.ts`:

```ts
export interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement?: boolean;
  default?: string;
}
```

Remove `engine` from `UpdateConnectionDto`; engine selection is allowed only during creation.

Add a DDL-preview request/response to `packages/shared-types/src/ddl.ts` (the existing request
types have no shared discriminator, so wrap them in an explicit `kind` union):

```ts
export type DdlPreviewRequest =
  | { kind: 'createTable'; request: CreateTableRequest }
  | { kind: 'alterTable'; request: AlterTableRequest }
  | { kind: 'createIndex'; request: CreateIndexRequest }
  | { kind: 'dropIndex'; request: DropIndexRequest };

export interface DdlPreviewResult {
  sql: string;
}
```

### Executing insert/update + result shape

Extend `apps/api/src/database/types.ts` — add only `lastInsertId` (MySQL needs the
connection-scoped generated key). `dataTypeName` stays optional for any engine that can report a
type name inline; engines that can't (PG, MySQL) leave it undefined and put the raw type
id/code in `dataTypeID`, with `describeResultColumns` doing the lookup/mapping:

```ts
export interface DriverResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  fields: { name: string; dataTypeID: number; dataTypeName?: string }[];
  rowCount: number | null;
  command: string;
  lastInsertId?: string | number;
}
```

No `DriverOperation` type and no `PoolManager.executePlan`. The grid uses
`PoolManager.withTransaction` — the **real-transaction** variant (auto `BEGIN`/`COMMIT`/`ROLLBACK`,
see the session/transaction split in Scope), distinct from `withSession` which the editor keeps:

```ts
// grid.service.ts — insert
const row = await this.pool.withTransaction(connectionId, (q) =>
  driver.insertRow(q, ref, entries, columns),
);
```

For Postgres/SQLite `insertRow` issues a single `INSERT ... RETURNING *` query through `q` and
returns the row (the surrounding `BEGIN`/`COMMIT` wraps one statement — harmless). For MySQL it
runs `INSERT`, reads `lastInsertId`, derives the PK per the narrow rule, then `SELECT`s the row on
the same connection — genuinely atomic because `withTransaction` issued `BEGIN`, so a re-select
failure rolls the `INSERT` back instead of orphaning a row.

### Driver contract

Update `apps/api/src/database/db-driver.interface.ts` so each driver:

- Exposes a serializable `descriptor`.
- Owns the two connection-pinning behaviors: `withSession` (pin only) and `withTransaction`
  (auto `BEGIN`/`COMMIT`/`ROLLBACK`). Today's single `withTransaction` becomes `withSession`;
  a new `withTransaction` adds the real begin/commit/rollback.
- Executes insert and update, returning the persisted row (one statement where `RETURNING`
  exists, two where it does not).
- Resolves result-column types via `describeResultColumns` (replaces `buildResolveTypeNames`).
- Normalizes and validates DDL requests (DDL policy moves off `DdlService`).
- Formats EXPLAIN rows.
- Reports metadata needed to preserve MySQL column definitions during `MODIFY COLUMN`.

The intended additions are — **executing methods, not plan objects**. They replace the existing
pure `buildInsertRow`/`buildUpdateRow` fragment builders (PG/SQLite keep one-statement impls):

```ts
readonly descriptor: DbEngineDescriptor;

/** Execute an insert and return the persisted row. `q` is the transactional query fn
 *  supplied by PoolManager.withTransaction (already inside BEGIN). PG/SQLite: one
 *  `INSERT ... RETURNING *`. MySQL: validate the narrow PK-derivation rule (complete supplied
 *  PK, or a PK missing exactly one AUTO_INCREMENT component) and throw
 *  `UnprocessableEntityException` BEFORE inserting if it does not hold; otherwise INSERT, read
 *  `insertId`, then SELECT by the full derived PK. `columns` supplies PK/AUTO_INCREMENT flags. */
insertRow(
  q: DriverQueryFn,
  ref: TableRef,
  entries: [string, unknown][],
  columns: ColumnMetadata[],
): Promise<Record<string, unknown>>;

/** Execute a single-column update and return the persisted row. Throws `NotFoundException`
 *  when the primary key matches no row (the driver now owns the "row no longer exists" check
 *  that `grid.service` previously did via `rowCount !== 1`). */
updateRow(
  q: DriverQueryFn,
  ref: TableRef,
  column: string,
  value: unknown,
  primaryKey: string[],
  primaryKeyValues: unknown[],
): Promise<Record<string, unknown>>;

normalizeCreateTable(req: CreateTableRequest): CreateTableRequest;
normalizeAlterTable(
  ref: TableRef,
  operation: AlterTableOperation,
  columns: ColumnMetadata[],
): AlterTableOperation;
normalizeCreateIndex(req: CreateIndexRequest): {
  request: CreateIndexRequest;
  name: string;
  method: string;
};

formatExplain(rows: Record<string, unknown>[]): string;

// Pinned-connection helpers (replaces the old single `withTransaction`):
/** Pin one connection, run `fn`, no automatic transaction. Used by QueryService. */
withSession<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
/** Pin one connection wrapped in BEGIN … COMMIT; ROLLBACK on throw. Used by grid mutations. */
withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;

/** Resolve result-column types into ColumnMetadata. PG runs a `pg_type` lookup through `query`
 *  (needs the OIDs in `fields[].dataTypeID`); MySQL maps mysql2's numeric type codes to names;
 *  SQLite returns declared types. Async because PG must hit the DB. Replaces buildResolveTypeNames. */
describeResultColumns(
  query: DriverQueryFn,
  fields: { name: string; dataTypeID: number; dataTypeName?: string }[],
  primaryKey?: string[],
): Promise<ColumnMetadata[]>;
```

> `withSession`/`withTransaction` are driver methods; `PoolManager` exposes matching
> `withSession(connectionId, fn)` / `withTransaction(connectionId, fn)` that resolve the pool and
> delegate. The MySQL driver must **not** map mysql2 type *names* — mysql2 fields expose numeric
> type codes (e.g. `3` = LONG, `253` = VAR_STRING); the driver maps codes → names.

`columns: ColumnMetadata[]` is passed so MySQL can locate the `AUTO_INCREMENT`/PK columns for
derivation; PG/SQLite ignore it. The pure SQL string assembly (the `INSERT`/`UPDATE`/`SELECT`
text) still lives in each engine's `*-sql.ts` and stays unit-testable without a DB — only the
*sequencing* moves into the driver method.

## File structure

Create:

- `apps/api/src/database/drivers/mysql/mysql-driver.ts` — native pool, result normalization, transactions, descriptors, executing `insertRow`/`updateRow`, and error mapping.
- `apps/api/src/database/drivers/mysql/mysql-sql.ts` — pure MySQL SQL builders.
- `apps/api/src/database/drivers/mysql/mysql-sql.test.ts` — pure dialect tests.
- `apps/api/src/database/drivers/mysql/mysql-driver.contract.test.ts` — live MySQL conformance suite.
- `apps/api/src/database/database-engines.controller.ts` — registered engine catalog endpoint.
- `apps/api/src/database/database-engines.controller.test.ts` — catalog endpoint tests.

Modify:

- `apps/api/src/database/types.ts`
- `apps/api/src/database/db-driver.interface.ts`
- `apps/api/src/database/db-driver.registry.ts`
- `apps/api/src/database/pool-manager.service.ts` (add `withSession` + real `withTransaction`)
- `apps/api/src/database/database.module.ts`
- `apps/api/src/database/testing/driver-contract.ts`
- PostgreSQL and SQLite driver and SQL-builder files.
- Connection DTOs, service, and tests.
- Metadata, grid, DDL, query, and AI services and tests.
- Shared connection, metadata, and DDL types.
- Connection modal, DDL modals, SQL editor, and associated tests.
- `packages/utils/src/parseConnectionString.ts` and tests.
- `apps/api/package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `README.md`, `CLAUDE.md`, and architecture documentation.

## Task 1: Expand shared engine and column contracts

**Files:**

- Modify: `packages/shared-types/src/connection.ts`
- Modify: `packages/shared-types/src/metadata.ts`
- Modify: `packages/shared-types/src/ddl.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify tests and fixtures that construct `ConnectionDto`, `ColumnMetadata`, or `NewColumn`.

- [ ] Add `'mysql'` to `DbEngine`.
- [ ] Add `DbEngineDescriptor` using the exact shape in this plan.
- [ ] Add `autoIncrement` and `defaultValue` to `ColumnMetadata`.
- [ ] Add optional `autoIncrement` to `NewColumn`.
- [ ] Remove `engine` from the shared update DTO.
- [ ] Run `rtk pnpm -w typecheck` and use the resulting failures to update all fixtures explicitly.
- [ ] Run `rtk pnpm -w test`.
- [ ] Commit:

```bash
git add packages/shared-types apps
git commit -m "feat: define MySQL engine and column capabilities"
```

## Task 2: Add registry-backed engine descriptors

**Files:**

- Modify: `apps/api/src/database/db-driver.interface.ts`
- Modify: `apps/api/src/database/db-driver.registry.ts`
- Create: `apps/api/src/database/database-engines.controller.ts`
- Create: `apps/api/src/database/database-engines.controller.test.ts`
- Modify: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/src/database/drivers/pg/pg-driver.ts`
- Modify: `apps/api/src/database/drivers/sqlite/sqlite-driver.ts`

- [ ] Write registry tests for descriptor enumeration, deterministic ordering, and duplicate engine rejection.
- [ ] Add PostgreSQL and SQLite descriptors.
- [ ] Add `DbDriverRegistry.listDescriptors()`.
- [ ] Reject duplicate driver registrations during registry construction.
- [ ] Add authenticated `GET /database-engines`.
- [ ] Verify descriptors never expose credentials or environment values.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- database-engines db-driver
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/database
git commit -m "feat(api): expose registered database engines"
```

## Task 3: Enforce engine validation and immutability

**Files:**

- Modify: `apps/api/src/connections/dto/create-connection.dto.ts`
- Modify: `apps/api/src/connections/dto/update-connection.dto.ts`
- Modify: `apps/api/src/connections/dto/test-connection.dto.ts`
- Modify: `apps/api/src/connections/connections.service.ts`
- Modify: `apps/api/src/connections/connections.service.test.ts`

- [ ] Write tests proving MySQL can be created and tested.
- [ ] Write tests proving an unknown engine is rejected before persistence or connection attempts.
- [ ] Write tests proving update requests cannot change engine.
- [ ] Remove static `@IsIn` engine lists and validate through `DbDriverRegistry`.
- [ ] Preserve the stored engine when editing or testing an existing connection.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- connections
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/connections
git commit -m "feat(api): validate and lock connection engines"
```

## Task 4: Atomic seam migration — executing insert/update + session/transaction split

> **One atomic task: the branch must build and pass at this commit.** It changes the `DbDriver`
> interface *and* every implementor and caller together, so there is no broken intermediate
> commit. MySQL is **not** involved yet (its driver doesn't exist until Task 7). Do this TDD:
> update the affected unit tests alongside each change.

**Files:**

- Modify: `apps/api/src/database/types.ts` (add `lastInsertId`)
- Modify: `apps/api/src/database/db-driver.interface.ts`
- Modify: `apps/api/src/database/pool-manager.service.ts` (add `withSession` + real `withTransaction`)
- Modify: `apps/api/src/database/pool-manager.service.test.ts`
- Modify: `apps/api/src/database/drivers/pg/pg-driver.ts`, `drivers/sqlite/sqlite-driver.ts`
- Modify: `apps/api/src/grid/grid.service.ts`, `grid/grid.service.test.ts`
- Modify: `apps/api/src/query/query.service.ts`, `query/query.service.test.ts`
- Modify: `apps/api/src/database/testing/driver-contract.ts`

- [ ] Add `lastInsertId?: string | number` to `DriverResult`.
- [ ] **Session/transaction split.** Rename each driver's current `withTransaction` (pin-only) to
      `withSession`. Add a new `withTransaction` that issues `BEGIN`, runs `fn`, `COMMIT`s, and
      `ROLLBACK`s on throw (PG: on the pinned `client`; SQLite: `BEGIN`/`COMMIT`/`ROLLBACK` on the
      handle). Add matching `PoolManager.withSession`/`withTransaction`.
- [ ] Point `QueryService.executeTransactional` at `pool.withSession` (it still emits its own
      `BEGIN`/`COMMIT`/`ROLLBACK` statements — unchanged behavior; assert statement count / COMMIT
      row / error attribution are identical in its tests).
- [ ] Replace `buildInsertRow`/`buildUpdateRow` on the interface with executing
      `insertRow(q, ref, entries, columns)` / `updateRow(q, ref, column, value, pk, pkValues)`.
      Implement on PG and SQLite as one `INSERT/UPDATE ... RETURNING *` through `q` (reuse the
      existing `*-sql.ts` builders; return `rows[0]`). `columns` accepted and ignored. `updateRow`
      throws `NotFoundException` when `rowCount` is not 1.
- [ ] Switch `grid.service` insert/update to `pool.withTransaction(id, (q) => driver.insertRow/updateRow(q, …))`;
      pass live `columns` to `insertRow` and PK info to `updateRow`; move the `rowCount !== 1` →
      404 check out of `updateCell` (now in `updateRow`). Keep 404/422 behavior and response shapes.
- [ ] Confirm `buildDeleteRow`, `buildSelectRows`, and all other pure builders stay fragment-based.
- [ ] Extend `driver-contract.ts`: `insertRow`/`updateRow` return the persisted row
      (capability-aware), and `withTransaction` rolls back on throw (insert then force a failure →
      assert no row persisted).
- [ ] Run (must be green):

```bash
rtk pnpm --filter @prost/api test
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/database apps/api/src/grid apps/api/src/query
git commit -m "refactor(api): executing insert/update + session/transaction split"
```

## Task 5: PG/SQLite metadata defaults, DDL normalization, EXPLAIN formatting

> The insert/update + transaction work is done in Task 4. This task adds the remaining
> driver-owned behaviors PG and SQLite need before MySQL joins, each keeping existing output.

**Files:**

- Modify: `apps/api/src/database/drivers/pg/pg-driver.ts`, `pg/pg-sql.ts`, `pg/pg-sql.test.ts`
- Modify: `apps/api/src/database/drivers/sqlite/sqlite-driver.ts`, `sqlite/sqlite-sql.ts`, `sqlite/sqlite-sql.test.ts`
- Modify: `apps/api/src/database/db-driver.interface.ts` (add `describeResultColumns`, DDL
  normalization methods, and `formatExplain`; drop `buildResolveTypeNames`)
- Modify: `apps/api/src/database/testing/driver-contract.ts`
- Modify: `apps/api/src/metadata/metadata.service.ts`, `metadata/metadata.service.test.ts`
- Modify: `apps/api/src/query/query.service.ts`, `query/query.service.test.ts`

- [ ] Extend the PG/SQLite metadata SQL + `metadata.service` mapping to populate
      `ColumnMetadata.defaultValue` (from each engine's `default_value`) and `ColumnMetadata.autoIncrement`
      (from each engine's `is_auto_increment`).
- [ ] PostgreSQL auto-increment detection: `true` when the column is an identity column
      (`is_identity = 'YES'`) **or** its default is a `nextval(...)` sequence call; else `false`.
- [ ] SQLite auto-increment detection: report `false` unless reliably detected (single-column
      `INTEGER PRIMARY KEY` / `AUTOINCREMENT`); do not guess.
- [ ] Replace `buildResolveTypeNames` with `describeResultColumns(query, fields, primaryKey?)`:
      PG runs the `pg_type` OID lookup through `query`; SQLite returns declared types. (MySQL impl
      lands in Task 10.) Update `query.service` to call it.
- [ ] Add `normalizeCreateTable`, `normalizeAlterTable`, and `normalizeCreateIndex` to the driver
      interface and implement them for PG/SQLite without changing existing PostgreSQL output.
- [ ] Add `formatExplain` to the driver interface and implement it for PG/SQLite, preserving
      PostgreSQL `QUERY PLAN`. **Wire `query.service`'s EXPLAIN handling to call
      `driver.formatExplain` here** (PG/SQLite output byte-for-byte unchanged, asserted in tests),
      so the MySQL parity task only adds the MySQL impl, never touches the PG EXPLAIN path.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- pg-sql sqlite-sql driver.contract metadata query
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/database apps/api/src/metadata apps/api/src/query
git commit -m "refactor(api): driver-owned metadata defaults, DDL normalization, type resolution"
```

## Task 6: Add pure MySQL SQL builders

**Files:**

- Create: `apps/api/src/database/drivers/mysql/mysql-sql.ts`
- Create: `apps/api/src/database/drivers/mysql/mysql-sql.test.ts`

Implement and test:

- Backtick quoting, including embedded backticks and invalid identifiers.
- `?` placeholders.
- Database-qualified table names (`` `db`.`table` ``), where `db` is the connection's database.
- Metadata queries **scoped to the connected database** — every `information_schema` query filters
  on `TABLE_SCHEMA = ?` bound to the connection's `database`. No multi-database enumeration and no
  system-database exclusion list (single-database scope already excludes the system schemas).
- Column aliases matching the existing metadata service contract.
- Primary-key and `AUTO_INCREMENT` detection through `information_schema`.
- Index metadata with ordered column arrays and normalized method/definition fields.
- Row selection, filtered count, approximate count, delete, and PK selection.
- Create table, alter table, create index, and drop index.
- MySQL type-name handling and EXPLAIN normalization helpers.

> Resolving the connected database inside the builders:
> - The parameterless builders (`buildListTables`, `buildListAllColumns`) filter on
>   `TABLE_SCHEMA = DATABASE()` — the mysql2 pool connects with the connection's `database` as the
>   default schema, so `DATABASE()` returns it. This keeps the builders pure and per-connection-stateless
>   (drivers are singletons shared across connections; they must not hold a database name).
> - The `TableRef`-taking builders (`buildListColumns`, `buildListIndexes`, CRUD, DDL) filter on
>   `TABLE_SCHEMA = ?` / qualify `` `db`.`table` `` using `ref.namespace`, which the metadata/grid
>   services set to the connection's database (for MySQL, `namespace` = database, just as it = schema
>   for Postgres).

- [ ] Write the tests first.
- [ ] Run the tests and confirm they fail because `mysql-sql.ts` does not exist.
- [ ] Implement the minimum builders needed to pass.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- mysql-sql
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/database/drivers/mysql
git commit -m "feat(api): add pure MySQL SQL builders"
```

## Task 7: Implement and register `MysqlDriver`

**Files:**

- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/database/drivers/mysql/mysql-driver.ts`
- Create: `apps/api/src/database/drivers/mysql/mysql-driver.test.ts`
- Modify: `apps/api/src/database/database.module.ts`

- [ ] Add `mysql2` as an API runtime dependency.
- [ ] Create a `mysql2/promise` pool using the existing connection fields.
- [ ] Map `sslEnabled` and `sslRejectUnauthorized` onto MySQL TLS options.
- [ ] Apply configured pool size, connect timeout, and query timeout.
- [ ] Install pool error listeners without logging credentials.
- [ ] Normalize array query results and result headers into `DriverResult`. Put mysql2's **raw
      numeric column type code** in `fields[].dataTypeID` (the OID-equivalent); leave `dataTypeName`
      undefined. Code→name mapping is owned solely by `describeResultColumns` (Task 10) — `query()`
      does **not** map names.
- [ ] Preserve `insertId` as `lastInsertId`.
- [ ] Implement `withSession` (acquire one `PoolConnection`, no transaction) and `withTransaction`
      (acquire one `PoolConnection`, `BEGIN`/`COMMIT`, `ROLLBACK` on throw, always release).
- [ ] Implement the complete `DbDriver` interface before registration so this task builds and
      typechecks:
      - `insertRow`/`updateRow` using the deterministic PK behavior specified in Task 8;
      - `normalizeCreateTable`/`normalizeAlterTable`/`normalizeCreateIndex` using the policies
        specified in Task 9;
      - `describeResultColumns` using the mysql2 numeric type-code mapping specified in Task 10;
      - `formatExplain` using normalized MySQL EXPLAIN output.
      Tasks 8–10 add exhaustive behavior tests and service-level integration; they do not leave
      required interface methods unimplemented after this task.
- [ ] Implement a shared `assertSupportedVersion(versionString)`: throw/reject when it contains
      `MariaDB` or major version `< 8`.
- [ ] `testConnection` runs `SELECT VERSION()` and returns a clear `TestConnectionResult` failure
      via the guard.
- [ ] **Also enforce the guard at pool initialization** — on first connection (e.g. a one-time
      `SELECT VERSION()` when the pool is created, before it serves queries), so a connection saved
      without pressing "Test" still cannot run against MariaDB/pre-8.0; surface a clear error.
- [ ] Set the MySQL `descriptor.ddl.indexMethods` to `['btree']` only — InnoDB ignores
      `USING HASH` (silently builds BTREE), so advertising HASH would mislead. (HASH can be
      revisited if MEMORY-engine tables are ever in scope.)
- [ ] Register MySQL in `DatabaseModule`.
- [ ] Run:

```bash
rtk pnpm install
rtk pnpm --filter @prost/api test -- mysql-driver
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/database
git commit -m "feat(api): add MySQL database driver"
```

## Task 8: Harden MySQL `insertRow`/`updateRow`

**Files:**

- Modify: `apps/api/src/database/drivers/mysql/mysql-driver.ts`
- Modify: `apps/api/src/database/drivers/mysql/mysql-driver.test.ts`
- Modify: `apps/api/src/database/drivers/mysql/mysql-sql.ts`
- Modify: `apps/api/src/database/drivers/mysql/mysql-sql.test.ts`
- Modify: `apps/api/src/database/testing/driver-contract.ts`

> `insertRow`/`updateRow` run `INSERT`/`UPDATE` then a `SELECT` through the supplied `q`. The grid
> already wraps the call in `PoolManager.withTransaction` (Task 4), so the `INSERT` and re-`SELECT`
> run inside one `BEGIN … COMMIT` — atomic, no transaction control inside the driver method.
> Task 7 provides complete interface implementations so registration and typecheck succeed.
> This task hardens mutation behavior with exhaustive SQL and live contract coverage.

- [ ] Verify and harden the **narrow PK-derivation rule** implemented in Task 7: accept
      (1) a complete supplied PK
      → re-select by it; (2) a PK missing exactly one `AUTO_INCREMENT` component → fill it from
      `insertId`, re-select by the full key. Reject all other cases (no PK, >1 missing component,
      no `AUTO_INCREMENT` to supply a missing component, default-only insert) with
      `UnprocessableEntityException` **before** running the `INSERT`. No value-matching fallback.
- [ ] Test insert with a complete supplied primary key (re-select by supplied PK).
- [ ] Test insert with one missing `AUTO_INCREMENT` PK component (re-select by `insertId`).
- [ ] Test composite primary keys (one `AUTO_INCREMENT` + supplied rest).
- [ ] Test rejection (422, no row created) for: no PK, multiple missing components, missing
      non-`AUTO_INCREMENT` component, default-only insert.
- [ ] Test update returning the changed row, and updating a PK column then selecting by the new PK.
- [ ] Handle MySQL's default affected-row semantics: assigning the existing value may report zero
      changed rows even though the row exists. Always re-select using the resulting PK and throw
      `NotFoundException` only when that re-selection returns no row; never use update `rowCount`
      alone to decide whether the row exists.
- [ ] Add a contract test that updates a column to its current value and still returns that row.
- [ ] Test that re-selection failure rolls back the mutation (no orphan row) — relies on the
      Task 4 `withTransaction`.
- [ ] Do not infer rows using "latest row" ordering or non-unique columns.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- mysql driver-contract
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/database/drivers/mysql apps/api/src/database/testing
git commit -m "feat(api): return MySQL mutation rows atomically"
```

## Task 9: Move DDL validation behind the driver

**Files:**

- Modify: `packages/shared-types/src/ddl.ts`, `packages/shared-types/src/index.ts` (`DdlPreviewRequest`/`DdlPreviewResult`)
- Modify: `apps/api/src/ddl/ddl.service.ts`, `ddl/ddl.service.test.ts`
- Modify: `apps/api/src/ddl/ddl.controller.ts`, `ddl/ddl.controller.test.ts` (preview route)
- Create: `apps/api/src/ddl/dto/ddl-preview.dto.ts` (class-validator DTO for the `kind` union)
- Modify: `apps/api/src/database/db-driver.interface.ts`
- Modify: `apps/api/src/database/drivers/pg/pg-driver.ts`
- Modify: `apps/api/src/database/drivers/sqlite/sqlite-driver.ts`
- Modify: `apps/api/src/database/drivers/mysql/mysql-driver.ts`
- Modify: `apps/api/src/database/drivers/pg/pg-sql.ts`, `pg/pg-sql.test.ts`,
  `drivers/sqlite/sqlite-sql.ts`, `sqlite/sqlite-sql.test.ts`,
  `drivers/mysql/mysql-sql.ts`, `mysql/mysql-sql.test.ts` (driver `normalize*` builders)

- [ ] Add `DdlPreviewRequest`/`DdlPreviewResult` to `packages/shared-types/src/ddl.ts` (exact shape
      in Public interface changes) and re-export from `index.ts`.
- [ ] Write tests proving `DdlService` contains no PostgreSQL type, default, cast, or index-method policy.
- [ ] Delegate create-table normalization to the active driver.
- [ ] Delegate alter-table normalization using current column metadata.
- [ ] Delegate index name and method normalization.
- [ ] Add the preview route **exactly**: `POST /connections/:id/ddl/preview` whose body is the
      `DdlPreviewRequest` `kind` union (validated by `ddl-preview.dto.ts`), returning
      `DdlPreviewResult` (`{ sql: string }`). It runs the identical driver `normalize*` + `build*`
      path as execution but **never** calls `pool.run`/`withTransaction`. Guard it behind the same
      auth + read-only checks as the execute routes.
- [ ] For MySQL, support the descriptor's type list, safe defaults, `AUTO_INCREMENT`, `BTREE` only
      (no HASH — InnoDB ignores it), and `MODIFY COLUMN`.
- [ ] When emitting `MODIFY COLUMN`, preserve type, nullability, default, and auto-increment attributes not changed by the request.
- [ ] Map MySQL duplicate/missing/invalid DDL errors to the existing 409/422 semantics.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- ddl
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add packages/shared-types apps/api/src/ddl apps/api/src/database/db-driver.interface.ts apps/api/src/database/drivers
git commit -m "refactor(api): make DDL validation engine-owned"
```

## Task 10: Complete MySQL metadata, filters, queries, and EXPLAIN

**Files:**

- Modify: `apps/api/src/metadata/metadata.service.ts`
- Modify: `apps/api/src/metadata/metadata.service.test.ts`
- Modify: `apps/api/src/grid/filter.ts`
- Modify: `apps/api/src/grid/filter.test.ts`
- Modify: `apps/api/src/query/query.service.ts`
- Modify: `apps/api/src/query/query.service.test.ts`
- Modify: `apps/api/src/query/editability.ts`
- Modify: `apps/api/src/query/editability.test.ts`
- Modify: `apps/api/src/database/drivers/mysql/mysql-driver.ts` (MySQL `describeResultColumns`).
- Modify: `apps/api/src/database/drivers/mysql/mysql-driver.test.ts`

> `describeResultColumns(query, fields, primaryKey?)` already exists on the interface and on PG/
> SQLite (Task 5), and Task 7 supplies a complete initial MySQL implementation so registration
> typechecks. This task completes its mapping coverage and integrates it with metadata/query flows.

- [ ] Parse MySQL metadata aliases without service-level engine checks.
- [ ] Add MySQL type families to filter validation.
- [ ] Use collation-driven MySQL `LIKE`.
- [ ] Generate `IN (?, ...)` and `NOT IN (?, ...)`, including empty-list behavior.
- [ ] Parse arbitrary SQL with the MySQL parser dialect.
- [ ] Resolve unqualified table references against the saved connection database (not PostgreSQL's
      `public`). The connection database is dynamic, so resolution reads it from the connection at
      runtime — `descriptor.defaultNamespace` is `'public'` for PG and left undefined for MySQL.
- [ ] Verify and complete MySQL `describeResultColumns` from Task 7: exhaustively map the raw
      numeric type code in `fields[].dataTypeID` to a public type name and add representative tests
      for integer, decimal, text, binary, temporal, JSON, and unknown codes. No `pg_type`/OID
      round-trip is needed, so the `query` argument goes unused for MySQL. This method is the
      **sole** owner of code→name mapping (Task 7's `query()` only carries the code).
- [ ] Confirm MySQL EXPLAIN renders via `driver.formatExplain` (the call-site was wired for all
      engines in Task 5); add MySQL EXPLAIN-output tests. Do not modify the PG EXPLAIN path here.
- [ ] Preserve statement splitting, paging, truncation, editability, autocommit, and transactional behavior.
- [ ] Run:

```bash
rtk pnpm --filter @prost/api test -- metadata filter query editability
rtk pnpm --filter @prost/api typecheck
```

- [ ] Commit:

```bash
git add apps/api/src/metadata apps/api/src/grid apps/api/src/query apps/api/src/database
git commit -m "feat(api): add MySQL metadata and query parity"
```

## Task 11: Add connection URI parsing and MySQL connection UX

**Files:**

- Modify: `packages/utils/src/parseConnectionString.ts`
- Modify: `packages/utils/src/parseConnectionString.test.ts`
- Modify: `apps/web/src/connection/ConnectionModal.tsx`
- Modify: `apps/web/src/connection/ConnectionModal.test.tsx`
- Modify: `apps/web/src/connection/connectionDisplay.ts`
- Create: `apps/web/src/api/databaseEngines.ts` (engine-catalog fetch hook; `GET /database-engines`)

- [ ] Generalize URI parsing to return the detected engine.
- [ ] Continue accepting `postgres://` and `postgresql://`.
- [ ] Accept `mysql://` and default to port `3306`.
- [ ] Parse common MySQL `ssl-mode` values into the existing SSL fields.
- [ ] Fetch the engine catalog when opening the modal.
- [ ] Add an engine picker for new connections.
- [ ] Apply descriptor defaults when the new-connection engine changes.
- [ ] Include `engine` in create and unsaved test requests.
- [ ] Hide or disable the picker for existing connections.
- [ ] Render engine-specific labels and server versions.
- [ ] Keep PostgreSQL defaults and tests unchanged.
- [ ] Run:

```bash
rtk pnpm --filter @prost/utils test
rtk pnpm --filter @prost/web test -- ConnectionModal
rtk pnpm -w typecheck
```

- [ ] Commit:

```bash
git add packages/utils apps/web/src/connection apps/web/src/api/databaseEngines.ts
git commit -m "feat(web): add MySQL connection setup"
```

## Task 12: Make DDL modals descriptor-driven

**Files:**

- Modify: `apps/web/src/ddl/CreateTableModal.tsx`, `ddl/CreateTableModal.test.tsx`
- Modify: `apps/web/src/ddl/AddColumnModal.tsx`, `ddl/AddColumnModal.test.tsx`
- Modify: `apps/web/src/ddl/EditColumnModal.tsx`, `ddl/EditColumnModal.test.tsx`
- Modify: `apps/web/src/ddl/CreateIndexModal.tsx`, `ddl/CreateIndexModal.test.tsx`
- Use the `apps/web/src/api/databaseEngines.ts` hook created in Task 11 (engine catalog).
- Create: `apps/web/src/api/ddlPreview.ts` (calls `POST /connections/:id/ddl/preview` with a
  `DdlPreviewRequest`, returns `DdlPreviewResult`)

- [ ] Replace duplicated PostgreSQL type arrays with descriptor values.
- [ ] Replace duplicated default hints with descriptor values.
- [ ] Show `AUTO_INCREMENT` only when advertised.
- [ ] Show `USING` expressions only when advertised.
- [ ] Restrict index methods to descriptor values.
- [ ] Request previews only after the modal's required local fields pass validation. Debounce
      valid preview requests by 300 ms, cancel or ignore superseded responses, and clear the
      displayed preview whenever the form becomes invalid so typing does not generate expected
      4xx responses or display stale SQL.
- [ ] Replace locally generated SQL previews with the `ddlPreview` server response
      (`DdlPreviewResult.sql`), sending the matching `DdlPreviewRequest` `kind`.
- [ ] Test PostgreSQL and MySQL controls and preview output.
- [ ] Run:

```bash
rtk pnpm --filter @prost/web test -- ddl
rtk pnpm --filter @prost/web build
```

- [ ] Commit:

```bash
git add apps/web/src/ddl apps/web/src/api
git commit -m "feat(web): drive DDL controls from database engines"
```

## Task 13: Make editor and AI behavior engine-aware

**Files:**

- Modify: `apps/web/src/workspace/SqlEditorView.tsx`
- Modify: `apps/web/src/workspace/SqlEditorView.test.tsx`
- Modify: `apps/api/src/ai/ai.service.ts`
- Modify: `apps/api/src/ai/ai.service.test.ts`

- [ ] Select the formatter dialect from the active connection's engine descriptor.
- [ ] Preserve Monaco SQL language registration and schema completions.
- [ ] Resolve the active driver or connection engine before constructing AI prompts.
- [ ] Name MySQL, PostgreSQL, or SQLite accurately in generate/explain/chat modes.
- [ ] Test formatter selection and prompt text for each engine.
- [ ] Run:

```bash
rtk pnpm --filter @prost/web test -- SqlEditorView
rtk pnpm --filter @prost/api test -- ai.service
rtk pnpm -w typecheck
```

- [ ] Commit:

```bash
git add apps/web/src/workspace apps/api/src/ai
git commit -m "feat: make SQL tooling engine-aware"
```

## Task 14: Add live MySQL contract coverage

**Files:**

- Create: `apps/api/src/database/drivers/mysql/mysql-driver.contract.test.ts`
- Modify: `apps/api/src/database/testing/driver-contract.ts`
- Modify: `docker-compose.yml`
- Create: `docker/demo-target-mysql-init.sql` (mirror `docker/demo-target-init.sql`:
  `users`/`orders`/`products`, with at least one `AUTO_INCREMENT` PK and one composite PK).
- Modify: `.env.example`

- [ ] Add `demo-target-mysql` using a pinned MySQL 8.0 image (e.g. `mysql:8.0.39`), mounting the
      init script.
- [ ] Expose it on host port `3307`.
- [ ] Configure database/user/password as `demo`.
- [ ] Add health checking with `mysqladmin ping`.
- [ ] Run the shared contract against MySQL.
- [ ] Extend the contract with metadata shape, filters, transaction rollback, DDL/error mapping, auto-increment insertion, PK-changing update, type metadata, and EXPLAIN.
- [ ] Keep unreachable live contracts skippable for local unit-test runs.
- [ ] Verify manually:

```bash
rtk docker compose up -d demo-target-postgres demo-target-mysql
rtk pnpm --filter @prost/api test -- driver.contract
```

- [ ] Commit:

```bash
git add docker-compose.yml docker .env.example apps/api/src/database
git commit -m "test(api): run driver contracts against MySQL"
```

## Task 15: Require both live engines in CI

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `apps/api/src/database/testing/driver-contract.ts` (honor `REQUIRE_LIVE_DRIVER_CONTRACTS`:
  when set, a contract whose DB is unreachable fails instead of skipping).

- [ ] Add a MySQL 8.0 service with a health check.
- [ ] Add `CONTRACT_MYSQL_*` environment values.
- [ ] Add `REQUIRE_LIVE_DRIVER_CONTRACTS=true`.
- [ ] Make required-live mode fail if PostgreSQL or MySQL cannot be reached.
- [ ] Keep local behavior unchanged when the flag is absent.
- [ ] Validate the workflow syntax and run the full local suite.
- [ ] Commit:

```bash
git add .github/workflows/ci.yml apps/api/src/database/testing
git commit -m "ci: require PostgreSQL and MySQL driver contracts"
```

## Task 16: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture-principles.md`
- Modify: `.env.example`

- [ ] Describe Prost as a multi-engine client rather than PostgreSQL-only.
- [ ] Document MySQL 8.0+ support and MariaDB exclusion.
- [ ] Document MySQL connected-database-only browsing (the connection's `database` is the single
      namespace; sibling databases are not shown).
- [ ] Document MySQL URI and TLS handling.
- [ ] Document the executing insert/update methods and the deterministic insert-row PK
      derivation/rejection rule (complete PK, or one missing `AUTO_INCREMENT` component; else 422).
- [ ] Document local MySQL Docker credentials and ports.
- [ ] Search for stale PostgreSQL-only statements:

```bash
rtk rg -n "PostgreSQL client|PostgreSQL database|postgres://|5434" README.md CLAUDE.md docs .env.example
```

- [ ] Commit:

```bash
git add README.md CLAUDE.md docs .env.example
git commit -m "docs: document MySQL target support"
```

## Final verification

- [ ] Start both live target engines:

```bash
rtk docker compose up -d demo-target-postgres demo-target-mysql
```

- [ ] Confirm both are healthy:

```bash
rtk docker compose ps
```

- [ ] Run all checks:

```bash
rtk pnpm -w build
rtk pnpm -w typecheck
rtk pnpm -w lint
rtk pnpm -w test
```

- [ ] Confirm both live contracts executed rather than skipped.
- [ ] Manually verify:
  - Create and test a MySQL connection.
  - Browse the connected database's tables; confirm sibling databases on the server are not listed.
  - Filter, sort, insert, update, and delete rows.
  - Create/alter a table and create/drop an index.
  - Execute SELECT, DML, DDL, transactions, and EXPLAIN.
  - Format MySQL SQL.
  - Generate an AI response whose prompt identifies MySQL.
  - Re-run the same core workflow against PostgreSQL.
- [ ] Confirm `rtk git status --short` contains only intentional changes.
- [ ] Commit any final test-only or documentation corrections separately.

## Acceptance criteria

- MySQL 8.0+ provides the same supported workflows as PostgreSQL.
- Feature services contain no `engine === 'mysql'` branches.
- The frontend uses engine descriptors rather than duplicated MySQL conditionals.
- Successful MySQL grid inserts and updates return the complete persisted row.
- MySQL inserts succeed only for a complete supplied PK or a PK missing exactly one
  `AUTO_INCREMENT` component; every other case fails with 422 **before** any row is created.
- No `DriverOperation`/`executePlan` abstraction exists; insert/update are executing driver methods
  run through `PoolManager.withTransaction`. PG/SQLite insert/update stay single-statement.
- `PoolManager.withTransaction` genuinely wraps `BEGIN`/`COMMIT`/`ROLLBACK`; a forced re-select
  failure after a MySQL insert leaves no orphan row (contract-tested).
- `PoolManager.withSession` (pin-only) backs the SQL editor; its `BEGIN`/`COMMIT`/`ROLLBACK` batch
  semantics, statement count, COMMIT result row, and error attribution are unchanged for PostgreSQL.
- No driver implements a dead `buildResolveTypeNames` OID stub; type resolution is
  `describeResultColumns(query, fields, primaryKey?)`.
- MariaDB and pre-8.0 MySQL connections are rejected at **both** test time and pool initialization.
- MySQL advertises `BTREE` index method only.
- Every committed task builds and passes typecheck (no intentionally broken intermediate commits).
- PostgreSQL and SQLite behavior remains compatible.
- PostgreSQL and MySQL live contracts are mandatory and passing in CI.
- Build, typecheck, lint, and all tests pass.
