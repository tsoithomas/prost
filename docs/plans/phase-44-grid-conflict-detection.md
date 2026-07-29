# Prost — Phase 44: Grid Concurrency — Optimistic-Conflict Detection

## Context

Phase 18 gave the grid type-aware editors, staged bulk edits, and undo/redo, but left one gap noted in its
own scope: **concurrent-edit detection**. Today a cell write is a blind `UPDATE … WHERE pk = …` — if the
row changed underneath the user (another session, another tab), the edit silently overwrites it. This
strengthening phase adds **optimistic-concurrency detection**: the server carries a per-row version token,
re-checks it on write, and returns a specific conflict instead of clobbering. It depends on Phases 2
(editing) and 18 (grid depth).

Roadmap item: Phase 44 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md).

## Decisions (to confirm before building)

1. **The server issues a per-row version token as grid metadata (principles §4, §5).** `GridResponse`
   gains an **optional** per-row version token — derived from a natural version/timestamp column where one
   exists, else a hash of the row's current column values computed server-side. It travels as metadata
   (like `editable`/`primaryKey`), not a new grid; the client never computes it.
2. **The token is re-validated server-side on write, never trusted from the client (principle §4).** On an
   update/delete the client echoes the token; the server **re-reads the row and re-derives the token**,
   and only proceeds if it still matches — closing the stale/forged-metadata gap exactly as editability
   re-validation does. The write stays PK-keyed and parameterized (§2, §8).
3. **A conflict is a specific, honest error (principles §8, §11).** A mismatch returns a specific `409`
   (distinct from SQL/timeout/auth classes) carrying enough for the UI to offer **reload-and-retry**; the
   optimistic update is rolled back and the divergence surfaced — never a silent clobber.
4. **Fail safe (principle §4).** If a token can't be derived (no version column, unhashable row), the write
   path falls back to today's behavior for that row but the analyzer marks it clearly; the feature never
   makes an editable row silently less safe.
5. **Engine-uniform via the driver (principle §1).** Token derivation and the compare-and-write live behind
   the driver seam (each engine's idiom); feature services get `{ token }`, no engine branch.

## Backend (`apps/api`)

### `GridService` + driver
- The driver's row read attaches a version token; the update/delete builders add the token re-check
  (compare-and-set on the derived token, PK-keyed, parameterized). `GridService` maps a mismatch to a
  specific `409` (extend the error classes, §11). `GridResponse` in `@prost/shared-types` gains the
  optional token field.

### Tests (Vitest, `apps/api`)
- A write with a current token succeeds; a write with a stale token → `409`, nothing changed; the token is
  re-derived server-side (echoed value not trusted); rows without a derivable token fall back safely;
  parameterized, PK-keyed writes unchanged.

## Frontend (`apps/web` + `packages/ui`)

### Conflict surfacing
- Cell/row edits carry the token; on `409` the optimistic update rolls back (Phase 8 pattern) and a
  **reload-and-retry** affordance appears (re-fetch the row, re-apply if desired). Staged bulk edits
  (Phase 18) report per-row conflicts in their result summary.

### Tests (Vitest, `apps/web` — per Phase 12)
- A conflicting edit rolls back and shows the retry affordance; a non-conflicting edit persists; bulk edits
  report conflicting rows separately.

## Verification

### Manual (demo target DBs)
1. Open a row in Prost; change it in a second session (psql); edit the same cell in Prost → a conflict is
   surfaced with reload-and-retry, not a silent overwrite; reload → retry succeeds.
2. A normal edit (no concurrent change) still applies optimistically.
3. A staged bulk edit where one row changed underneath reports that row as conflicted and applies the rest.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Multi-row transactional merge UIs / three-way merge; server-side row locking.
- Real-time presence/collaboration (single-user — §13).
- Conflict detection on DDL (this is row-data concurrency only).
