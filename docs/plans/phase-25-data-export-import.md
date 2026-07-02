# Prost — Phase 25: Data Export & Import

## Context

Prost can display and edit rows but cannot get data **out** to a file or **in** from one. The only
"export" today is *query-history* text export (Phase 19); there is no CSV/JSON export of table rows
or query results, and no import path. This phase adds both — a core database-client capability.

The whole game is principle §7 (**never load more than a page**): export must **stream** rather than
buffer whole tables, so it rides the forward-only server-side cursor built in Phase 22
(`apps/api/src/query/cursor-session.service.ts`). Import reuses the established **preview → confirm →
execute** DDL/write pattern and the parameterized insert path (principle §2), and honors the Phase 27
read-only connection guard (it must not exist as an import target on a read-only connection).

Roadmap item: Phase 25 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md). Depends on Phase 27.

## Decisions (to confirm before building)

1. **Export streams through the Phase 22 cursor, never a full buffer (principles §1, §7).** An export
   opens a cursor over the (parameterized, optionally filtered) query and writes rows to the HTTP
   response in chunks (`Transfer-Encoding: chunked`), formatting CSV/JSON as it goes. The API never
   holds the whole result in memory, and the browser triggers a file download rather than rendering
   rows. Cursor lifecycle (open/close/reap) follows Phase 11/22 exactly.
2. **Export scopes are "current table (with active filter)" and "current query result."** Both map to
   a bound SQL statement the cursor already knows how to stream. A row/time budget bound applies
   (principle §7); truncation is signalled honestly in a trailer/notice (principle §11), never silent.
3. **CSV is RFC-4180-correct and NULL-distinct.** Quoting, embedded delimiters/newlines, and a
   configurable delimiter are handled by a shared formatter in `packages/utils` (framework-free,
   principle §10). `NULL` is distinguishable from empty string (empty field vs. an explicit token per
   an option). JSON export emits an array of row objects (typed values preserved where possible).
4. **Import is preview → confirm → execute, fully parameterized (principles §2, §8).** Upload a CSV →
   the server parses a bounded sample, the user maps CSV columns → target columns (types drawn from
   metadata), and a **preview** shows the first N rows + the generated parameterized `INSERT` shape.
   On confirm, rows insert in **batched transactions** through the driver seam (`PoolManager.with
   Transaction`), all-or-nothing per batch, with a progress + error report. No raw SQL from the
   client, ever.
5. **Import respects read-only and validates against live schema (principles §3, §4).** The target
   connection must not be `readOnly` (Phase 27) — the server rejects the write, not just the UI.
   Column names/types are validated against live metadata before any insert; a type-incompatible
   mapping or unknown column → specific `400`, nothing executed.

## Backend (`apps/api`)

### `ExportModule` (new)
- `GET`/`POST` export endpoint (connection-scoped, ownership-guarded) that opens a cursor via the
  Phase 22 cursor-session service and streams CSV/JSON chunks. Reuses the rows/query SQL builders +
  active `RowFilter`; enforces the budget and signals truncation.
- A shared `toCsvRow`/`csvEscape` (and JSON) formatter in `packages/utils` with unit tests.

### `ImportModule` (new)
- Endpoints to (a) parse an uploaded CSV header + sample and propose a column mapping, and (b)
  execute the import: validate mapping against `MetadataService`, then batched
  `PoolManager.withTransaction` inserts through the driver's `buildInsertRow`/`insertRow`. Rejects a
  `readOnly` connection (Phase 27) and invalid mappings with specific errors (principle §11).
- Bounded upload size + row/batch caps (principle §7).

### Tests (Vitest, `apps/api`)
- Export: streams via cursor (no full buffer), CSV escaping/NULL handling, filter applied, truncation
  budget signalled, cursor closed on completion/error. Import: mapping validated against metadata,
  parameterized batched inserts (no interpolation), read-only connection → rejected, invalid mapping
  → 400, partial-failure reporting.

## Frontend (`apps/web` + `packages/ui`)

### Export
- Grid toolbar **Export** control (table view + query results): choose format (CSV/JSON), delimiter,
  and scope (all rows / current filter), triggering the streamed download. A truncation notice
  surfaces when the budget is hit. Mobile parity (principle §9).

### Import
- An **Import** flow (from the table view / schema tree): file picker → column-mapping table
  (metadata-driven target columns) → preview (first N rows + generated statement shape) → confirm
  (behind `useConfirm`, danger-gated) → progress + result summary. Hidden/blocked on read-only
  connections (mirrors the server guard, principle §4).

### Tests (Vitest, `apps/web` — per Phase 12)
- Export control issues the right request per format/scope; import mapping UI builds the expected
  payload; preview renders; confirm triggers execution; read-only connection hides/blocks import.

## Verification

### Manual (demo target DBs)
1. Export `users` as CSV → downloaded file matches rows; a value containing a comma/quote/newline is
   correctly escaped; NULLs are distinguishable.
2. Export a **filtered** view and a **query result** as JSON → contents match the visible data.
3. Export a very large table → streams (no memory spike), truncation notice appears at the budget.
4. Import a CSV into a new/empty table → mapping + preview correct; confirm inserts rows; a
   type-mismatched row is reported, not silently dropped.
5. Attempt import on a `readOnly` connection (Phase 27) → blocked in UI **and** rejected by the
   server.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- `pg_dump`/`mysqldump`-style schema+data dump/restore (structural backup is a separate concern).
- Excel/Parquet and other binary formats (CSV + JSON only in v1).
- Upsert/merge on import (insert-only; conflict handling beyond "report and continue/abort" deferred).
- Scheduled/recurring exports (no background jobs — §13).
