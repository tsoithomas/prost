# Prost — Phase 3: SQL Editor + Editable Results

## Context

Phases 1–2 deliver the table-driven path: browse a table, view rows, edit/insert/delete them.
Phase 3 opens the **arbitrary SQL** path: a Monaco editor where the user runs any statement
and sees results in the **same grid component**, editable **only when the backend says it's
safe**.

The SQL Editor tab already exists visually (`apps/web/src/workspace/SqlEditorView.tsx`), wired
to a mock result (`apps/web/src/mocks/orderResults.ts`). Phase 3 replaces that mock with real
execution and introduces the **editability analyzer** — the canonical example of principle §4
("the backend decides; the frontend renders").

The result contract already exists: `QueryResult extends GridResponse` with `executionTimeMs`
(`packages/shared-types/src/grid.ts`). Phase 3 implements `QueryModule` behind it and reuses
the Phase 1 grid + Phase 2 write path verbatim — no second result format, no second grid
(principle §5).

## Decisions (to confirm before building)

1. **New `QueryModule`** (spec §6.7, principle §10) — `POST /connections/:id/query` taking
   `{ sql }`, returning `QueryResult`. It owns execution + the editability analyzer; it does
   **not** duplicate `GridModule`'s write path — editable results route their mutations through
   the **existing** Phase 2 endpoints, keyed by the analyzer-provided `sourceTable` + `primaryKey`.
2. **Editability analyzer is server-side and parser-backed** (spec §6.7). Use a SQL parser
   (`node-sql-parser`, Postgres dialect). A result is editable **only when all hold**: single
   `SELECT`; exactly one table; no joins; no aggregates / `GROUP BY` / `DISTINCT`; the table's
   PK column(s) present in the projection (resolve PK via `MetadataService`). Otherwise
   read-only. The frontend trusts the returned `{ editable, sourceTable, primaryKey }` verbatim
   and **never re-derives it** (principle §4).
3. **Execution stays bounded** (principle §3): every statement runs under the existing
   `statement_timeout` via `PgConnectionService`. Timeout, SQL, and connection errors are
   surfaced as **distinct** classes (principle §11).
4. **Result size is paged/capped, not unbounded** (principle §7). MVP decision to confirm:
   wrap the user's `SELECT` for paging (e.g. apply a server `LIMIT`/`OFFSET` window) **or** cap
   returned rows with an explicit "result truncated" signal. Non-`SELECT` statements
   (`UPDATE`/`DELETE`/DDL) return affected-row counts, not a row grid. Default page size 100,
   consistent with the table view.
5. **Mutations on an editable result reuse Phase 2.** The analyzer's `sourceTable` +
   `primaryKey` feed the same `GridModule` write endpoints; the server **re-validates** them
   against live schema on each write (principle §4) — the echoed analyzer metadata is a hint,
   not authorization.
6. **No persistence yet.** Saving/listing executed queries is **Phase 4**; Phase 3 executes
   and renders only.

## Backend (`apps/api`)

### `QueryModule` (new — `apps/api/src/query/`)

- `query.controller.ts`: `POST /connections/:id/query`, JWT-guarded, `@CurrentUser()`-scoped,
  body `{ sql: string }` validated by class-validator (`execute-query.dto.ts`).
- `query.service.ts`:
  - **Parse** `sql` with `node-sql-parser` (Postgres). Classify: single `SELECT` vs. multi /
    non-select / unparseable.
  - **Execute** through `PgConnectionService.runParameterized` (the user's SQL is the statement;
    any paging window is appended with bound `$n` limit/offset — never string-concatenated
    values, principle §2). Capture `executionTimeMs` and whether `statement_timeout` fired.
  - **Analyze editability** (the truth table in Decision 2). When editable, resolve the table's
    PK via `MetadataService` and confirm PK columns appear in the projection.
  - Map `pg` field metadata → `ColumnMetadata[]` so the same grid renders it. Return
    `QueryResult { rows, columns, totalRows?, editable, sourceTable, primaryKey, executionTimeMs }`.
- `editability.ts` (pure, unit-testable): takes parsed AST + resolved PK, returns
  `{ editable, sourceTable?, primaryKey? }`. Keep it dependency-light and exhaustively tested —
  this is correctness-critical (principle §4).

### Errors & observability (principles §11, §12)

- Distinguish **SQL error** (bad syntax / constraint), **timeout** (`statement_timeout` fired),
  **connection error**. The global filter already produces the safe envelope; add finer error
  codes/messages for these.
- Log route, connection id, outcome, and **duration**; log SQL text but **never** bound values
  or result rows (principle §12).

## Frontend (`apps/web`)

### `SqlEditorView.tsx` — real execution

- Monaco already themed (`packages/ui/src/editor/monacoTheme.ts`). Wire **Cmd/Ctrl+Enter** to
  run (spec §5.4). Add a `useExecuteQuery` TanStack mutation (`src/api/query.ts`) calling
  `apiFetch<QueryResult>`.
- Render results in the **same** grid the table view uses, fed by `QueryResult`. Drop the
  `orderResults` mock once live.
- **Editable results:** when `editable === true`, enable inline edit/insert/delete by reusing
  the Phase 2 mutation hooks, keyed by the analyzer's `sourceTable` + `primaryKey`. When
  `false`, the grid is read-only — the frontend reads the flag, never computes it (principle §4).
- Show `executionTimeMs`, row count, and (if applicable) a "result truncated" indicator in the
  results header. Surface SQL/timeout/connection errors distinctly in the editor's error slot,
  each with its `correlationId`.

### Mobile (principle §9, spec §8.5)

Monaco full-width, height-capped, results grid stacked below; run reachable from the bottom
navbar. Verify at 360px.

## Verification

### Unit (Vitest, `apps/api`)
- **Editability truth table** (`editability.ts`) — the spec's examples must pass exactly:
  - Editable: `SELECT * FROM users`, `SELECT id, name, email FROM users` (PK present).
  - Read-only: `SELECT COUNT(*) FROM users`, `SELECT * FROM users JOIN orders ON …`,
    `SELECT department, COUNT(*) FROM users GROUP BY department`, `SELECT name FROM users`
    (PK absent from projection), any non-`SELECT`, any multi-statement input.
- Paging window builder is parameterized (no interpolated limit/offset).

### End-to-end (manual, demo target DB — spec §11 step 6)
1. Run `SELECT * FROM users` → grid editable; edit a cell → persists via Phase 2 path.
2. Run `SELECT COUNT(*) FROM users` → single read-only cell.
3. Run a JOIN and a `GROUP BY` query → read-only grid.
4. Run a deliberately slow query → **timeout error** distinct from a syntax error.
5. Run invalid SQL → **SQL error** with a clear message, no stack trace, correlation id present.
6. Run an `UPDATE`/`DELETE` → affected-row count, no editable grid.
7. Large `SELECT` → only a page loads; truncation/paging behaves per Decision 4.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- **Query history persistence + recent-queries panel** → Phase 4.
- Multi-statement scripts, transactions/`BEGIN…COMMIT` blocks, `EXPLAIN`/query plans.
- Autocomplete / schema-aware IntelliSense in Monaco, query formatting.
- Saving named queries / snippets, parameterized user queries.
- Streaming/cursor-based results beyond simple paging.
