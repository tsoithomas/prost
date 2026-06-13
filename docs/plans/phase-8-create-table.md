# Prost — Phase 8: Create Table

## Context

Every target-DB write so far is **DML keyed by primary key** (`GridService` update/insert/
delete) — row-level changes to existing tables. Phase 8 introduces the first **DDL-writing**
capability: a guided "Create Table" flow that takes a table name, a set of columns
(name, type, nullable, default), and a primary-key choice, generates a `CREATE TABLE`
statement, **previews the exact SQL**, and on confirmation executes it through the existing
`PgConnectionService` choke point.

This stage is **foundational**: it establishes the **generate → preview → confirm → execute**
DDL pattern (and the server-side safety rails around it — identifier quoting, a type
allow-list) that Phase 9 (edit schema/indexes) reuses. It depends on nothing but the existing
metadata/connection plumbing; Phase 7's structure panel is the natural place to launch it from
but isn't strictly required.

Backlog item: "Create table" in [`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **New `DdlModule`, not an extension of `GridModule`.** Grid is DML (row ops keyed by PK);
   DDL is a distinct responsibility (principle §10). The module owns table creation now and
   `ALTER`/index DDL in Phase 9.
2. **DDL is generated server-side from a structured request, never from client SQL.** The
   client sends a typed `CreateTableRequest` (shape below); the server builds the statement.
   The client **never** sends raw SQL to this endpoint — that path already exists (the SQL
   editor / `QueryModule`) and carries its own analysis. Keeping DDL structured is what lets us
   validate it (principles §2, §4).
3. **Identifiers are quoted; types are allow-listed.** Table and column names go through
   `quoteIdent` (principle §2). Column **types** can't be quoted as identifiers, so they are
   validated against a **server-side allow-list** of supported Postgres types (with optional
   length/precision args parsed and bounded) — an unknown type is a 422, never interpolated
   raw.
4. **Column defaults are the sharp edge.** A `DEFAULT` expression can't be a bound parameter in
   DDL. v1 supports defaults only as: (a) a typed literal bound-and-cast where Postgres allows,
   or (b) a small allow-list of safe functions (`now()`, `gen_random_uuid()`, …). Arbitrary
   default expressions are **rejected in v1**, not interpolated. Document this limit in the UI.
5. **Preview-then-confirm is mandatory** (principle §8 — mutations feel safe). The endpoint can
   return the generated SQL for display; execution requires an explicit confirm. The generated
   SQL is shown verbatim so there's no hidden behavior.
6. **`CreateTableRequest` / `CreateTableResult` live in `@prost/shared-types`** (principle §6):
   ```ts
   export interface NewColumn {
     name: string;
     type: string;          // validated against the server allow-list
     nullable: boolean;
     isPrimaryKey: boolean;
     default?: string;      // restricted per Decision 4
   }
   export interface CreateTableRequest {
     schema: string;
     table: string;
     columns: NewColumn[];
   }
   export interface CreateTableResult { schema: string; table: string; sql: string; }
   ```

## Backend (`apps/api`)

### `DdlModule` / `DdlService.createTable`

- Resolve and validate the request:
  - At least one column; column names unique; table name non-empty. Quote schema/table/column
    names with `quoteIdent`.
  - Each `type` validated against the **type allow-list** (a `packages/utils` or module-local
    constant); reject unknown types (422) with an actionable message.
  - PK: zero or more columns flagged `isPrimaryKey` → a single `PRIMARY KEY (...)` clause;
    reject if a flagged column doesn't exist in the column list.
  - `default` validated per Decision 4; reject anything outside the allow-list.
- Build `CREATE TABLE <qSchema>.<qTable> (<col defs>[, PRIMARY KEY (...)])` and execute via
  `PgConnectionService.runParameterized` (no params in the statement itself, but it still goes
  through the one choke point — principle §1; the service logs connection id / duration /
  outcome, never the SQL's literal values beyond what's already logged).
- Map Postgres DDL errors (e.g. `42P07` duplicate table, `42704` undefined type that slips the
  allow-list, syntax) to specific, safe messages (principle §11) — not a generic 500.
- Return `CreateTableResult` with the generated `sql`.

### `DdlController`
- `POST :id/ddl/tables` (or `:id/tables` under a DDL sub-path) under the JWT guard, ownership
  asserted via `connectionsService.assertOwnership` exactly like metadata/grid routes. A
  `CreateTableDto` (class-validator) structurally matching `CreateTableRequest` (principle §6).
- Optionally a `POST :id/ddl/tables/preview` that runs generation + validation and returns the
  SQL **without executing**, to back the preview step (or the create endpoint returns SQL and
  the UI gates execution — decide during build, but don't ship a create that bypasses preview).

### Tests (Vitest, `apps/api`)
- `ddl.service.test.ts`: generated SQL **quotes every identifier** and **interpolates no
  user value as a raw identifier**; the type allow-list rejects unknown types; PK clause is
  emitted correctly for zero/one/many PK columns; disallowed defaults are rejected. This is the
  security spine of the stage (mirrors `grid.service.test.ts`).

## Frontend (`apps/web`)

### Mutation hook
- `apps/web/src/api/ddl.ts` (new) — `useCreateTable(connectionId)` and (if separate) a preview
  call, following the `src/api/grid.ts` mutation pattern. On success, invalidate
  `useMetadata` so the new table appears in the tree.

### Create-table UI
- A modal/panel launched from the schema area (e.g. a "New Table" action near the schema in
  `SchemaTree`, or from Phase 7's structure surface):
  - Table name + target schema.
  - A **column editor**: add/remove rows, each with name, a **type dropdown sourced from the
    allow-list**, nullable checkbox, PK checkbox, optional default (with the v1 restriction
    surfaced as helper text).
  - A **SQL preview** pane showing the generated statement (read-only), refreshed as the form
    changes.
  - **Confirm** to execute; on success close, refresh the tree, and select/open the new table.
- Errors (duplicate table, invalid type) surface inline via the existing toast/error pattern
  with the correlation id (principle §11).
- Mobile-first layout per principle §9 (the column editor must be usable at ~360px).

## Verification

### Manual (demo target DB, port 5434)
1. Create `public.widgets` with `id serial PRIMARY KEY`, `name text NOT NULL`,
   `created_at timestamptz DEFAULT now()` → preview shows correctly-quoted SQL; confirm; the
   table appears in the tree and opens as an (empty, editable) grid.
2. Duplicate name → specific "table already exists" error, no 500.
3. Unknown/garbage type → rejected client-side (not in dropdown) and server-side (422) if
   forced.
4. A table with a multi-column PK → correct `PRIMARY KEY (a, b)` clause.
5. Attempt a disallowed default expression → rejected with a clear message.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- **Altering** existing tables / adding-dropping indexes → **Phase 9** (reuses this stage's
  generate→preview→confirm→execute pattern).
- Foreign keys, check/unique/exclusion constraints, generated columns, partitioning, table
  options (tablespace, `WITH`) — v1 creates plain tables with columns + a primary key.
- Creating schemas, views, sequences, functions, extensions.
- Arbitrary `DEFAULT` expressions beyond the Decision-4 allow-list.
- Transactional multi-statement DDL scripts (that overlaps the deferred SQL-editor
  multi-statement item).
