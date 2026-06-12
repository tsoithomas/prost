# Prost — Phase 2: Inline Editing (update / insert / delete)

## Context

Phase 1 delivered the read path: login → connection → schema tree → paginated, **read-only**
table grid. The grid already renders through AG Grid's Infinite Row Model and every
`GridResponse` already carries the server-computed `editable` flag and `primaryKey` array —
in Phase 1 these are returned correctly but the UI ignores them (toolbar buttons in
`apps/web/src/workspace/TableView.tsx` are present but inert).

Phase 2 turns those signals into real mutations: edit a cell in place, insert a blank row,
delete a row — all parameterized, all keyed by primary key, all with optimistic UI and
rollback. This is the `GridModule` **write path** (spec §6.6) and the frontend editing UX
(spec §5.3).

The request shapes already exist in `@prost/shared-types`: `RowUpdateRequest`,
`RowInsertRequest`, `RowDeleteRequest` (see `packages/shared-types/src/grid.ts`). Phase 2
implements the endpoints and UI behind them — it does not invent new contracts.

## Decisions (to confirm before building)

1. **Write endpoints live in the existing `GridModule`**, beside the read path — same module,
   same `PgConnectionService` choke point. Routes mirror the read route's connection scoping:
   - `PATCH /connections/:id/tables/:schema/:table/rows` — single-cell update.
   - `POST  /connections/:id/tables/:schema/:table/rows` — insert, `RETURNING *`.
   - `DELETE /connections/:id/tables/:schema/:table/rows` — delete by PK (PK in body, not URL,
     to support composite keys cleanly).
2. **Server re-validates editability and PK on every write** (principle §4): the controller
   re-resolves columns + PK from `MetadataService` (as the read path already does) and
   validates that the target column / PK columns exist and that the table has a usable PK.
   Client-echoed `primaryKey`/`sourceTable` are **hints, never authorization** — the server
   trusts only freshly-resolved metadata.
3. **One cell per update request.** Matches the spec's `RowUpdateRequest` (`column` + `value`
   + `primaryKey`). Keeps the SQL trivial and the optimistic-rollback unit small. Multi-cell
   row edits are not in scope.
4. **Inserts open a blank client row**; only non-empty columns are sent. Server builds the
   column list from validated identifiers; DB defaults/serials fill the rest; `RETURNING *`
   gives the grid the canonical persisted row (so serial PKs, defaults, triggers are
   reflected).
5. **Deletes require explicit confirmation** in the UI (principle §8) and are keyed by PK.
6. **No new write choke point.** All three endpoints funnel through
   `PgConnectionService.runParameterized` exactly like reads (principle §1).

## Backend (`apps/api`)

### `GridModule` write path

Extend `apps/api/src/grid/grid.service.ts` with three methods, each following the read path's
shape: resolve columns + PK via `MetadataService`, validate identifiers against the live
column set, build parameterized SQL with `quoteIdent` on every identifier, bind all values as
`$n`, execute through `PgConnectionService`.

- **`updateCell(connectionId, schema, table, req: RowUpdateRequest)`**
  - Re-resolve columns; assert `req.column` ∈ columns and every key in `req.primaryKey` is an
    actual PK column. Reject (422) if the table has no PK or the supplied keys don't match the
    real PK set exactly.
  - SQL: `UPDATE <qSchema>.<qTable> SET <qColumn> = $1 WHERE <qPk1> = $2 [AND <qPk2> = $3 …]`.
  - Bind `value` then the PK values in column order. Assert exactly one row affected;
    0 rows → 404/409 (row changed/deleted under us), surfaced as a specific error.
  - Return the updated row (`RETURNING *`) so the grid reconciles against canonical state.

- **`insertRow(connectionId, schema, table, req: RowInsertRequest)`**
  - Re-resolve columns; filter `req.values` to validated column names (drop unknown keys
    rather than trusting them).
  - SQL: `INSERT INTO <qSchema>.<qTable> (<qCols…>) VALUES ($1, $2, …) RETURNING *`. If
    `values` is empty, `INSERT … DEFAULT VALUES RETURNING *`.
  - Return the persisted row.

- **`deleteRow(connectionId, schema, table, req: RowDeleteRequest)`**
  - Validate PK keys as in update.
  - SQL: `DELETE FROM <qSchema>.<qTable> WHERE <qPk1> = $1 [AND …]`.
  - Assert exactly one row affected; 0 rows → 404.

### Controller + DTOs

- `apps/api/src/grid/grid.controller.ts`: add the three handlers, all under the existing JWT
  guard and `@CurrentUser()` scoping. Path params `:id/:schema/:table` parsed as today.
- DTOs in `apps/api/src/grid/dto/` validated with class-validator (`row-update.dto.ts`,
  `row-insert.dto.ts`, `row-delete.dto.ts`) — `primaryKey`/`values` as records, `column` a
  non-empty string. The DTO shapes must structurally match the `@prost/shared-types` request
  interfaces (principle §6).

### Error classes (principle §11)

The existing global exception filter already maps to the safe `{ error, message,
correlationId }` envelope. Ensure write-specific failures surface distinctly:
- **NOT NULL / CHECK / FK / unique violations** from `pg` → a specific `SQL_ERROR` (or a
  finer constraint code) with a human message, **not** a generic 500. Map common Postgres
  `error.code` values (`23502`, `23503`, `23505`, `23514`) to actionable messages.
- **0-rows-affected** on update/delete → a distinct "row no longer exists / changed" error so
  the client can revert and refetch.
- Never leak the bound values or row data into the message (principles §1, §3, §12).

## Frontend (`apps/web`)

### Mutation hooks (`src/api/grid.ts`, new)

TanStack Query mutations calling `apiFetch`, mirroring the existing `src/api/connections.ts`
pattern: `useUpdateCell`, `useInsertRow`, `useDeleteRow`. These do **not** invalidate the
whole grid on success (that would refetch every block); instead they apply optimistic updates
to the AG Grid datasource and reconcile against the returned row.

### `TableView.tsx` — wire the inert toolbar

- **Editable gating:** column defs (`src/grid/columnDefs.tsx`) set `editable` per column only
  when `GridResponse.editable === true` **and** the column is not part of an unsafe set; the
  grid never computes editability itself (principle §4). The frontend reads the flag verbatim.
- **Cell edit (optimistic, principle §8):** on `cellValueChanged`, immediately keep the new
  value, fire `useUpdateCell` with the row's PK (extracted from `primaryKey` columns), and on
  error revert the cell to its previous value + show an error toast carrying the
  `correlationId`. On success, reconcile with the `RETURNING *` row.
- **Insert:** the `Plus` button adds a blank, visually-marked pending row at the top; on
  commit, `useInsertRow` sends non-empty cells; the persisted `RETURNING *` row replaces the
  pending row (serial PK / defaults now visible). Cancel discards it.
- **Delete:** the `Trash2` button is enabled when rows are selected; clicking opens a
  confirmation dialog (full-screen sheet on mobile, principle §9); confirm fires
  `useDeleteRow` per selected row and removes them optimistically, reverting on error.
- The **Save** button becomes a no-op/removed for single-cell-commit editing, or repurposed
  to flush a pending insert — decide during build; don't leave dead UI (principle §13 health).

### Toasts

Introduce a minimal toast surface in `packages/ui` (or `apps/web`) if one doesn't exist, for
optimistic-rollback error reporting. Keep it small — one component, token-themed, mobile-safe.

## Verification

### Unit (Vitest, `apps/api`)
Extend `grid.service.test.ts`:
- Update/insert/delete SQL builders produce **parameterized** statements — assert every
  identifier is quoted and **no value is interpolated** (the Phase 1 read-path test is the
  template).
- PK validation rejects unknown columns and tables without a PK (422), and rejects
  client-supplied PK columns that don't match the live PK set.
- Insert with empty `values` emits `DEFAULT VALUES`.

### End-to-end (manual, demo target DB — spec §11 step 4–5)
1. Inline-edit a cell → value persists across refetch.
2. Force a failure (edit a NOT NULL column to null, or violate a CHECK) → cell **reverts** and
   a specific error toast (NOT NULL / constraint) shows, with a correlation id.
3. Insert a row → blank row commits, serial `id` and defaults appear from `RETURNING *`.
4. Delete a row → confirm dialog → row disappears; cancel leaves it.
5. Concurrent-edit case: delete a row in another session, then edit it here → "row no longer
   exists" error, grid reconciles.
6. Confirm a read-only table (no PK, e.g. a view) renders non-editable and the write endpoints
   reject it server-side even if the client forged `editable: true`.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Multi-cell / whole-row transactional edits, bulk update, copy-paste ranges.
- Editing query-result grids — that arrives with the editability analyzer in **Phase 3**;
  Phase 2 only edits **table views** (where the single-table PK is unambiguous).
- Undo/redo history, optimistic-concurrency tokens / row versioning.
- Type-aware cell editors (date pickers, enum dropdowns) beyond AG Grid's defaults.
