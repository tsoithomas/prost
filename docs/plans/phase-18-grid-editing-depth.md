# Prost — Phase 18: Grid Editing Depth

## Context

Phase 2 delivered inline editing as **single-cell, single-request** updates plus row insert/
delete. This phase deepens the grid to the editing experience users expect from a TablePlus-style
client: **type-aware cell editors**, **multi-cell / whole-row transactional edits and paste
ranges**, **undo/redo with optimistic-concurrency conflict detection**, and **column pinning /
grouping**. It extends the Phase 2 write path through the same `GridService`/`PgConnectionService`
choke point and dovetails with **Phase 11**'s write-path hardening (the concurrency tokens are a
natural companion to the reliability work).

Backlog items (all under "Table view / grid" in [`../future-features.md`](../future-features.md)):
type-aware editors, multi-cell/bulk transactional edits + copy-paste ranges, undo/redo +
optimistic-concurrency / row versioning, column pinning/grouping.

## Decisions (to confirm before building — these gate data integrity)

1. **Bulk edits are one transactional request (principles §1, §2, §8).** A multi-cell/multi-row
   edit (or a pasted range) is sent as a batch and applied in a **single transaction** server-side:
   all-or-nothing, every value bound as `$n`, every identifier `quoteIdent`-ed. No
   client-orchestrated sequence of single writes that can half-apply.
2. **Optimistic concurrency is enforced server-side (principles §3, §4).** Each editable row
   carries a server-derived version token (the table's primary key plus a concurrency basis — e.g.
   `xmin`, or the pre-image of the edited columns where no version column exists). On write the
   server checks the row still matches the token; a mismatch returns a specific **409 conflict**
   (principle §11) naming the row, and **nothing in the batch commits**. The client never decides a
   write is safe.
3. **New/extended shared types (principle §6):** extend the row write contracts to a batch shape
   (`BulkRowUpdateRequest` = ordered cell edits with per-row version tokens; reuse
   `RowUpdateRequest`/`RowInsertRequest`/`RowDeleteRequest` element shapes) and a `RowConflict`
   response. One contract, both sides.
4. **Undo/redo is client-side over committed deltas, re-validated on apply (principle §8).** The
   grid keeps an undo stack of applied edits; "undo" issues a compensating transactional write that
   is **itself** concurrency-checked (an undo can conflict too, and must surface honestly) — undo
   is not a local-only illusion that drifts from the database.
5. **Type-aware editors come from metadata, render-only smarts (principle §4).** Date/time pickers,
   boolean toggles, enum dropdowns, numeric inputs are chosen from the column's data type
   (metadata) — but the **server** still validates/coerces on write; the editor is a convenience,
   not the source of truth.
6. **Pinning/grouping is presentation only (principle §5).** Column pin-left/right and row grouping
   are AG Grid config on the one grid contract — they never change the data request or the write
   path. Pin/group state is view state (optionally persisted with grid-density prefs in Phase 21).
7. **Editing only where the read is editable.** All of the above applies **only** to result sets
   the backend marks editable (single updatable base table) — Phase 11's analyzer remains the gate;
   bulk/paste is disabled on non-editable grids.

## Backend (`apps/api`)

### `GridService` (write path)
- A `bulkUpdate(connectionId, req)` that opens a transaction, applies each cell edit with a
  concurrency check (version token), and rolls back the whole batch on the first conflict/error —
  returning a `RowConflict` (409) or the per-row success summary.
- Derive and return the version token on the read path (rows endpoint) so the client has it to send
  back; choose the concurrency basis (`xmin` vs column pre-image) and document it.
- Validate/coerce values by column type; map type/constraint/conflict errors to specific codes
  (principle §11). All through `runParameterized` (principle §2).

### Tests (Vitest, `apps/api`)
- Bulk update commits atomically; a conflicting version token → 409, **zero** rows changed; type
  coercion/validation per column; paste-range maps to the expected batch; non-editable result
  rejects bulk writes. No raw interpolation anywhere.

## Frontend (`apps/web`)

### Grid (the one grid component, §5)
- Type-aware `cellEditor` selection from column metadata (date/time, boolean, enum, numeric, text).
- Range selection + copy/paste (AG Grid range features) compiling to a `BulkRowUpdateRequest`;
  whole-row edit batches multiple cells into one request.
- Undo/redo stack with keyboard shortcuts; each undo/redo issues a concurrency-checked write and
  surfaces conflicts via the existing error/confirm surfaces.
- Conflict UX: a clear, honest "row changed since you loaded it" message (principle §8/§11) with the
  option to refresh; no silent overwrite.
- Column pin-left/right + row grouping via grid config; mobile-aware (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- A range edit/paste produces the expected batch request; undo issues a compensating write; a 409
  surfaces the conflict and does not mutate the grid optimistically past the failure; type editors
  are chosen by column type; bulk tools are disabled on a non-editable grid.

## Verification

### Manual (demo target DB, port 5434)
1. Edit a date column → date picker; a boolean → toggle; an enum → dropdown. Each persists.
2. Select a range of cells, paste a block → one transactional write; all-or-nothing on error.
3. Edit several cells, undo/redo → database reflects each step; an undo against a row changed by
   another session → honest 409, not a silent clobber.
4. Pin a column left, group by a column → view updates; data request unchanged; still editable.
5. On a join/CTE (non-editable) result → bulk/paste/edit disabled.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Cross-table / cross-tab bulk edits; spreadsheet-style formulas.
- Server-persisted, multi-user collaborative editing / presence.
- Full row-version history / audit trail (concurrency token only, not a changelog).
- Importing CSV/Excel into a table (separate ingest feature, not in this slice).
