# Prost — Phase 9: Edit Schema & Indexes

## Context

Phase 7 made table structure **visible** (columns + indexes via the detail panel); Phase 8
introduced **DDL writes** and the **generate → preview → confirm → execute** pattern (plus the
`DdlModule`, `quoteIdent` rails, and the type allow-list) for `CREATE TABLE`. Phase 9 closes
the "view/**edit** schema and indexes" backlog item by adding the alter operations on top of
both:

- **Columns:** add a column, drop a column, change nullability, change type (with the
  cast caveat below), set/drop a default.
- **Indexes:** create an index (columns, unique, method), drop an index.

It reuses Phase 8's pattern wholesale — structured request → server-generated SQL →
preview → confirm → execute through `PgConnectionService` — so this stage is mostly new
operations on an established spine, not new infrastructure. It depends on **Phase 7** (you act
on the structure you can see) and **Phase 8** (the DDL module, allow-list, and preview flow).

Backlog item: "View/edit schema and indexes" in
[`../future-features.md`](../future-features.md) — Phase 9 delivers the **edit** half.

## Decisions (to confirm before building)

1. **One typed request per alter operation**, not a free-form diff. Discrete, validated
   operations in `@prost/shared-types` (principle §6), each generating one statement:
   ```ts
   export type AlterTableOperation =
     | { kind: 'addColumn'; column: NewColumn }                    // NewColumn from Phase 8
     | { kind: 'dropColumn'; column: string }
     | { kind: 'setNotNull'; column: string; notNull: boolean }
     | { kind: 'setDefault'; column: string; default: string | null }
     | { kind: 'changeType'; column: string; type: string; using?: string };
   export interface AlterTableRequest { schema: string; table: string; operation: AlterTableOperation; }
   export interface CreateIndexRequest {
     schema: string; table: string; name?: string;
     columns: string[]; unique: boolean; method?: string;
   }
   export interface DropIndexRequest { schema: string; index: string; }
   ```
2. **Every identifier is re-resolved against live metadata before generating SQL** (principle
   §4). Column/index names in a request are **locators**, not authorization: the server
   confirms the column/index exists on the named table via `MetadataService` (reusing Phase 7's
   `getTableStructure`) before building DDL — the same "echoed metadata is untrusted" rule the
   grid write path already enforces.
3. **Types and methods stay on the allow-list** from Phase 8 (types) plus an index-method
   allow-list (`btree`/`hash`/`gin`/`gist`/`brin`). `quoteIdent` on every identifier; defaults
   restricted exactly as Phase 8 Decision 4. No raw interpolation (principle §2).
4. **Type changes are explicitly risky and surfaced as such.** `ALTER COLUMN ... TYPE` can fail
   or rewrite the table; when a cast is needed the request must supply a validated `using`
   expression (allow-listed forms only). The preview makes the rewrite/lock implication
   visible; v1 does not attempt to auto-derive complex casts.
5. **Drops require strong confirmation** (principle §8). Dropping a column or index is
   destructive and irreversible — the confirm dialog states exactly what is lost (and warns
   that dropping a column drops its data). No `CASCADE` in v1 (a dependency error surfaces
   honestly rather than silently cascading).
6. **Preview-then-confirm, same as Phase 8.** Generated SQL shown verbatim before execution;
   nothing runs without an explicit confirm.

## Backend (`apps/api`)

### `DdlService` — alter + index methods

- `alterTable(connectionId, req: AlterTableRequest)`: resolve live structure, validate the
  operation's target column exists (or, for `addColumn`, does *not* already exist), validate
  type/default/`using` against the allow-lists, build the single `ALTER TABLE <qSchema>.<qTable>
  ...` statement, execute via `PgConnectionService.runParameterized`.
- `createIndex(connectionId, req: CreateIndexRequest)`: validate every column exists, method on
  allow-list; generate a name if absent (deterministic, quoted); build
  `CREATE [UNIQUE] INDEX <qName> ON <qSchema>.<qTable> USING <method> (<qCols>)`.
- `dropIndex(connectionId, req: DropIndexRequest)`: confirm the index exists in the schema
  (Phase 7 read), build `DROP INDEX <qSchema>.<qIndex>`.
- Map Postgres errors to specific messages (principle §11): undefined column/index (`42703`/
  `42704`), cannot-cast (`42846`), dependency errors on drop, duplicate index (`42P07`) — never
  a generic 500. Each op asserts its expected effect where meaningful.

### `DdlController`
- Under the existing JWT guard + `assertOwnership`:
  - `PATCH :id/ddl/tables/:schema/:table` (body = `AlterTableOperation`), or per-op sub-routes —
    pick one shape and keep DTOs (class-validator) structurally matching the shared types.
  - `POST :id/ddl/indexes` (create), `DELETE :id/ddl/indexes` (drop, index in body).
  - Optional `.../preview` variants backing the preview step, consistent with Phase 8.

### Tests (Vitest, `apps/api`)
- Extend `ddl.service.test.ts`: each operation generates **parameterized/quoted** SQL with **no
  raw value interpolation**; add/drop/notnull/default/type-change emit the expected clause;
  index create/drop quote names and validate columns; allow-list rejections (bad type, bad
  method, disallowed default/using) return 422; a request naming a non-existent column/index is
  rejected against live metadata.

## Frontend (`apps/web`)

### Mutation hooks
- Extend `apps/web/src/api/ddl.ts` with `useAlterTable`, `useCreateIndex`, `useDropIndex`
  (preview calls as needed), following the Phase 8 hooks. On success invalidate the table's
  `useTableStructure` (Phase 7) and, where structure changes affect the grid, the grid columns.

### Edit affordances in the structure panel (Phase 7)
- In `TableStructurePanel`:
  - **Columns:** per-column actions (edit type/nullable/default, drop) and an "Add column" form
    reusing Phase 8's column editor + type dropdown.
  - **Indexes:** an "Add index" form (column multiselect, unique toggle, method dropdown) and a
    per-index drop action.
- Every mutating action routes through a **SQL preview + confirm** step (reuse Phase 8's preview
  pane and the existing `useConfirm` dialog; drops use a `danger` confirm spelling out the loss,
  principle §8). Errors surface inline with the correlation id (principle §11).
- Mobile-first per principle §9 — the alter forms must work at ~360px (full-width bottom-sheet
  confirms already exist).

## Verification

### Manual (demo target DB, port 5434 — ideally on a Phase-8-created throwaway table)
1. Add a nullable `note text` column → preview, confirm, column appears in structure + grid.
2. Set it `NOT NULL` on an empty table → succeeds; on a table with nulls → honest constraint
   error, no 500.
3. Change a column's type with a valid `using` cast → preview shows the rewrite; confirm works.
4. Set and then drop a default → reflected in structure.
5. Create a unique btree index on a column → appears in the index list (Unique badge); create a
   duplicate → specific error.
6. Drop the index → danger confirm naming it → gone. Drop a column → danger confirm warning of
   data loss → gone from structure + grid.
7. Forge a request naming a non-existent column/index → 422, nothing executed.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Renaming tables/columns, reordering columns, `CASCADE` drops.
- Foreign-key / check / exclusion constraint management (only columns + indexes here).
- Online/`CONCURRENTLY` index builds, partitioning, table rewrites beyond a single
  `ALTER COLUMN TYPE ... USING`.
- Multi-operation transactional migrations / migration history (each op is one statement).
- Auto-deriving complex casts for type changes.
