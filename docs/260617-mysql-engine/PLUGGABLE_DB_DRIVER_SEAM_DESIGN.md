# Pluggable DB Driver Seam — Design

**Date:** 2026-06-16
**Status:** Approved (design); implementation plan pending
**Scope:** Refactor the existing PostgreSQL target-DB access behind a pluggable
`DbDriver` interface so additional engines (MySQL, SQLite, …) can be added later
as a single new driver class, with no edits to feature services. **This spec ships
no second engine** — Postgres is refactored behind the seam and behaves identically.

---

## 1. Goals & non-goals

### Goals
- Extract a `DbDriver` interface that owns **both** the native connection and **all
  dialect-specific SQL** for a target database.
- Move every raw target SQL string out of the feature services
  (`metadata`, `grid`, `ddl`, `query`) and into the driver.
- Select a driver per `Connection` via an engine-keyed registry (open/closed —
  adding an engine never edits a `switch`).
- Keep pool caching / idle-sweep / LRU policy written **once**, shared across engines.
- Ship a **driver-agnostic conformance test suite** so any future driver proves
  itself by passing the same tests.

### Non-goals (YAGNI — follow-on specs)
- No MySQL / SQLite / any second driver implementation.
- No frontend engine picker, no `mysql://` connection-string parsing.
- No change to the API wire contract or `@prost/shared-types` DTOs.
- No namespace-depth generalization in the UI (schema tree stays as-is).

### Success criteria
- All current Postgres functionality works unchanged (existing tests green).
- Feature services contain **zero** raw target SQL.
- `PgDriver` passes a new `runDriverContractTests(...)` suite against docker Postgres.
- A reviewer can describe how a new engine would be added without touching any
  feature service.

---

## 2. Architecture

Three layers, top to bottom:

```
Feature services (metadata, grid, ddl, query)
        │  call driver methods; hold NO dialect SQL
        ▼
   DbDriver (interface) ──registered in──▶ DbDriverRegistry (engine → driver)
        │  builds dialect SQL + talks to a native pool
        ▼
   PoolManager (shared: cache, idle-sweep, LRU, eviction policy)
        │  delegates create / query / close to the driver
        ▼
   native pool (pg.Pool today; mysql2 etc. later)
```

- **Feature services** keep orchestration only: building a `TableRef` from request
  params, sequencing transaction steps, and mapping driver result rows into the
  existing `@prost/shared-types` DTOs. They emit no SQL.
- **DbDriver** owns dialect SQL (quoting, placeholders, metadata queries, CRUD/DDL
  builders), native connection creation, query execution, transaction wrapping,
  capability flags, and native-error → HTTP-exception mapping.
- **PoolManager** owns the engine-agnostic pool lifecycle currently embedded in
  `PgConnectionService` (the `pools`/`poolLastUsed` maps, the sweep interval, LRU
  cap, and clean shutdown), delegating the engine-specific bits to the driver.
- **DbDriverRegistry** resolves `connection.engine` → the right `DbDriver`.

This preserves architecture principle #1 (single choke point for target DBs): the
`PoolManager` + `DbDriver.query` pair is the only path to a target database, all
values bind as parameters, and identifiers go through the driver's `quoteIdent`.

---

## 3. The `DbDriver` contract

```ts
// Neutral table reference. PG: namespace = schema. A non-schema engine (e.g. MySQL)
// would map namespace → database, or ignore it.
interface TableRef {
  namespace?: string;
  name: string;
}

interface DbCapabilities {
  supportsReturning: boolean;          // PG: true
  supportsSchemas: boolean;            // PG: true
  parserDialect: 'postgresql';         // node-sql-parser dialect (union grows per engine)
}

// What a driver hands back from a builder method: parameterized SQL only.
interface SqlFragment {
  sql: string;
  params: unknown[];
}

// Normalized result shape (today mirrors pg's result; engine-neutral).
interface DriverResult<T = Record<string, unknown>> {
  rows: T[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
}

// Opaque to callers; only the owning driver knows its concrete type.
type NativePool = unknown;
type DriverQueryFn = (q: SqlFragment) => Promise<DriverResult>;

interface DbDriver {
  readonly engine: string;                    // 'postgres'
  readonly capabilities: DbCapabilities;

  // --- connection lifecycle (called by PoolManager) ---
  createPool(params: ConnectionParams): Promise<NativePool>;
  closePool(pool: NativePool): Promise<void>;
  query(pool: NativePool, frag: SqlFragment): Promise<DriverResult>;
  withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
  testConnection(params: ConnectionParams): Promise<TestConnectionResult>;

  // --- dialect SQL builders (pure: input → SqlFragment) ---
  quoteIdent(identifier: string): string;
  buildListSchemas(): SqlFragment;
  buildListColumns(ref: TableRef): SqlFragment;
  buildListIndexes(ref: TableRef): SqlFragment;
  buildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment;
  buildRowCountEstimate(ref: TableRef): SqlFragment;
  buildInsertRow(ref: TableRef, values: Record<string, unknown>): SqlFragment;
  buildUpdateRow(ref: TableRef, set: Record<string, unknown>, pk: PkPredicate): SqlFragment;
  buildDeleteRow(ref: TableRef, pk: PkPredicate): SqlFragment;
  buildCreateTable(spec: CreateTableSpec): SqlFragment;
  buildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment;
  buildCreateIndex(spec: CreateIndexSpec): SqlFragment;
  buildDropIndex(ref: TableRef, indexName: string): SqlFragment;

  // --- error mapping ---
  // Inspect a native driver error and throw the appropriate Nest HTTP exception,
  // or return (no-op) to let the caller rethrow. Centralizes PG codes like
  // 42P07 (duplicate table) → ConflictException, 42846 (bad cast) → 422.
  mapError(error: unknown): void;
}
```

**Rationale for "fragments, not DTOs":** the driver knows SQL; the services know the
public DTO shapes. Keeping mapping in services means the wire contract never depends
on a driver, and a new driver author only has to return correctly-shaped rows — not
re-learn every DTO. Result rows use the column names the services already expect
(documented per builder), enforced by the conformance suite.

The exact `SelectRowsOptions`, `PkPredicate`, `CreateTableSpec`, `CreateIndexSpec`,
and `AlterTableOperation` shapes are lifted from the current `grid.service.ts` /
`ddl.service.ts` signatures unchanged — they are already engine-neutral inputs.

---

## 4. Pool lifecycle (`PoolManager`)

`PoolManager` is a single `@Injectable()` that absorbs the engine-agnostic machinery
currently in `PgConnectionService`:

- `pools: Map<connectionId, Promise<NativePool>>` and `poolLastUsed` map.
- `onModuleInit` sweep interval; `onModuleDestroy` clean shutdown of all pools.
- Idle eviction (`poolIdleMs`) and LRU cap (`poolMax`) — unchanged policy.
- `evictPool(connectionId)` (still called on connection delete / credential change).

For each operation it:
1. Resolves the `Connection` row (Prisma) and decrypts credentials (`CryptoService`).
2. Looks up the driver: `registry.get(connection.engine)`.
3. Gets/creates the cached pool via `driver.createPool(params)`.
4. Runs `driver.query(pool, frag)` or `driver.withTransaction(pool, fn)`.

Public methods the feature services use (replacing today's `runParameterized` /
`withTransactionClient` on `PgConnectionService`):

```ts
class PoolManager {
  run(connectionId: string, frag: SqlFragment): Promise<DriverResult>;
  withTransaction<T>(connectionId: string, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
  testConnection(connectionId | params): Promise<TestConnectionResult>;
  evictPool(connectionId: string): Promise<void>;
}
```

`PgDriver` holds only: `pg.Pool`/`pg.Client` construction (host/port/ssl/timeouts),
the `$n` placeholder style, `SHOW server_version`, and `ROLLBACK`-on-throw semantics.

---

## 5. Registry, DI, and the `engine` field

- **Schema:** add `engine String @default("postgres")` to the Prisma `Connection`
  model + a migration. Existing rows backfill to `"postgres"` via the default.
- **DTOs:** `CreateConnectionDto` gains an optional `engine` (validated against the
  set of registered engines; defaults to `"postgres"`). `UpdateConnectionDto`
  likewise. No frontend change required this spec (defaulting covers it).
- **Registry:** `DbDriverRegistry` is built from a Nest multi-provider token
  `DB_DRIVERS` (array of `DbDriver`). `registry.get(engine)` returns the driver or
  throws `BadRequestException` for an unknown/unregistered engine. Adding an engine =
  add one `@Injectable()` driver to the `DB_DRIVERS` provider array; nothing else.
- **Module:** a new `database/` module provides `DbDriverRegistry`, `PoolManager`,
  and `PgDriver`, and exports `PoolManager` (+ `DbDriverRegistry` for builder access).
  The existing `target-db/` module folds into `database/`; a thin re-export shim from
  the old path keeps import churn out of this diff where convenient.

---

## 6. `TableRef` migration

- Feature-service methods that take `(schema, table)` switch to a single `TableRef`.
- Controllers build `TableRef` from the existing `:schema/:table` route segments
  (`{ namespace: schema, name: table }`) — **API routes and request/response shapes
  are unchanged.**
- `PgDriver` reads `ref.namespace` as the Postgres schema and `ref.name` as the table,
  quoting both with its `quoteIdent`.
- Blast radius is contained to service signatures + the controllers that call them;
  the wire contract and frontend are untouched.

---

## 7. Service refactor (per feature)

Each service drops its SQL and calls the driver via `PoolManager` + the resolved
driver's builders. Net effect per file:

- **`metadata.service.ts`** — replace the `information_schema` / `pg_index` SQL with
  `driver.buildListSchemas/buildListColumns/buildListIndexes`; keep the row→DTO
  grouping/mapping logic.
- **`grid.service.ts`** — replace `SELECT *`, `INSERT … RETURNING`, `UPDATE`,
  `DELETE`, and the `pg_class.reltuples` estimate with the matching `build*`
  fragments. The insert-returns-row behavior is expressed by the driver (PG uses
  `RETURNING`; a future no-RETURNING engine encapsulates insertId + re-select behind
  the same `buildInsertRow` contract / result shape).
- **`ddl.service.ts`** — replace create/alter/index SQL string assembly with
  `driver.buildCreateTable/buildAlterTable/buildCreateIndex/buildDropIndex`; route
  caught native errors through `driver.mapError`.
- **`query.service.ts` / `editability.ts`** — the ad-hoc parser dialect
  (`database: 'postgresql'`) and EXPLAIN handling read from
  `driver.capabilities.parserDialect` instead of a hardcoded literal.

`quoteIdent` in `packages/utils` stays as the Postgres implementation and becomes
`PgDriver.quoteIdent`'s backing function (re-exported for existing callers/tests);
the interface-level `quoteIdent` is what services/builders use going forward.

---

## 8. Conformance test suite

`runDriverContractTests(makeDriver, dsn)` is a driver-agnostic Vitest suite asserting
behavior every driver must satisfy:

- **Quoting/escaping:** `quoteIdent` round-trips identifiers containing quotes; rejects
  null bytes/empty.
- **Placeholders:** parameter binding works and values never interpolate into SQL text.
- **Metadata shape:** `buildListColumns/Indexes` results contain the column names the
  services map (e.g. `column_name`, `is_nullable`, `is_primary_key`, index `columns[]`).
- **CRUD round-trip:** create → insert (returns the new row) → select → update →
  delete against a **real** docker database.
- **Capability honesty:** declared `capabilities` match observed behavior (e.g. if
  `supportsReturning` is true, insert returns the row).
- **Error mapping:** a duplicate-table create surfaces `ConflictException`, a bad cast
  surfaces `422`, etc.

`PgDriver` runs this suite now against `docker compose` Postgres. Existing per-service
unit tests remain but mock the driver/`PoolManager` instead of `pg`. A future driver
re-runs the same `runDriverContractTests` verbatim — extensibility is proven by a
green suite, not by inspection.

---

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Hidden PG-isms leak into a builder's result shape | Conformance suite pins result column names; services consume only those. |
| Large mechanical diff (SQL relocation) introduces regressions | Move SQL verbatim into `PgDriver` first (no behavior change), then refactor; keep existing tests green at each step. |
| `target-db/` → `database/` rename churns imports | Re-export shim from the old path; rename in a follow-up cleanup commit. |
| Interface under-fits a real second engine (we only have PG to fit) | Decisions (TableRef, capability flags, insert-returns-row via driver) were chosen specifically against the known MySQL gaps: no schemas, no RETURNING, backtick quoting, `?` placeholders. |

---

## 10. Rollout / sequencing (for the implementation plan)

1. Add `engine` field + migration + DTO default.
2. Introduce `database/` module skeleton: `DbDriver` interface, `DbCapabilities`,
   `TableRef`, `SqlFragment`, `DriverResult`, `DbDriverRegistry`, `DB_DRIVERS` token.
3. Build `PoolManager` by lifting lifecycle code out of `PgConnectionService`.
4. Implement `PgDriver` connection methods (createPool/query/withTransaction/test);
   wire registry + PoolManager; cut feature services over to `PoolManager.run`.
5. Move SQL into `PgDriver` builders verbatim; switch services to call builders +
   `TableRef`.
6. Add `runDriverContractTests`; run against `PgDriver` + docker Postgres.
7. Delete dead `PgConnectionService` code / leave re-export shim; confirm full suite +
   lint green.
