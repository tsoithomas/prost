# Prost — Phase 43: Data Generation / Test-Data Seeding

## Context

Populating a table with realistic test rows means hand-writing `INSERT`s or an external faker script.
Prost already has a batched, parameterized insert path (Phase 30 import) and knows each column's type and
FK relationships (Phases 7/23). This phase adds **data generation**: pick a table, choose a row count, and
Prost proposes type-appropriate fake values (respecting PKs, uniques, and FK references), then inserts them
through the **existing preview→confirm→batched-insert** seam. It is a DBA-depth slice depending on Phase 30
(insert path) and Phase 25 (read-only guard).

Roadmap item: Phase 43 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md).

## Decisions (to confirm before building)

1. **Generation is server-side and parameterized (principles §2, §7).** The server derives a per-column
   generator from metadata (type, nullability, uniqueness, FK target) and produces rows bound as
   parameters through the driver's insert path — **no client SQL, no interpolation**. Row counts are
   **capped** (a bounded batch budget, §7); large requests batch through `PoolManager.withTransaction`.
2. **FK-aware and constraint-respecting (principles §4, §8).** Generated values satisfy PKs/uniques and
   reference **existing** parent rows for FK columns (sampled from the referenced table). Where a complete
   valid row can't be generated (e.g. a required FK with no parent rows), the server reports it rather than
   inserting a violating row.
3. **Preview → confirm → execute, reusing Phase 30 (principle §8).** A preview shows the first N generated
   rows and the parameterized `INSERT` shape; on confirm, rows insert in batched transactions with a
   progress + error report — the exact Phase-30 import execution seam. Nothing auto-inserts.
4. **Blocked on read-only, audited (principles §4, §12).** Generation is a write: it requires the
   connection be writable (Phase 25, server-enforced) and every batch is audited (Phase 28).
5. **A small, typed generator config (principle §6).** A `DataGenSpec` in `@prost/shared-types` (table ref,
   row count, per-column generator choice/overrides) — the single contract the UI builds and the server
   validates.

## Backend (`apps/api`)

### `DataGenModule` (composing `ImportModule`)
- Endpoints to (a) propose a default `DataGenSpec` from metadata and a preview sample, and (b) execute:
  validate the spec against live metadata, generate rows server-side, and insert via the Phase-30 batched
  `PoolManager.withTransaction` path. Rejects read-only connections (Phase 25); FK columns sampled from the
  referenced table through the driver seam.

### Tests (Vitest, `apps/api`)
- Generators produce type-appropriate, constraint-respecting values (PK/unique/FK); inserts are
  parameterized + batched (no interpolation); a read-only connection is rejected; an unsatisfiable FK is
  reported, not violated; row-count cap enforced; batches audited.

## Frontend (`apps/web` + `packages/ui`)

### Generation flow
- A **Generate data** action (table view / schema tree): choose row count and per-column generator
  (metadata-defaulted), see a **preview** (sample rows + statement shape), then **confirm** (behind
  `useConfirm`) → progress + result summary. Hidden/blocked on read-only connections (mirrors the server
  guard). Mobile parity (§9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The flow builds the expected `DataGenSpec`; preview renders sample rows; confirm triggers execution;
  read-only connection hides/blocks generation.

## Verification

### Manual (demo target DBs)
1. Generate 100 rows into `products` → preview shows realistic values; confirm → rows appear in the grid.
2. Generate into `orders` (FK to `users`) → generated `user_id`s reference existing users; a table with an
   unsatisfiable required FK reports it rather than inserting.
3. A unique column gets distinct values; exceeding the row cap is refused with a clear message.
4. Generation on a read-only connection is blocked in UI and server-rejected; batches show in the audit log.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Complex multi-table referential graphs beyond simple FK satisfaction; realistic distributions/locale
  packs beyond a basic generator set.
- Deterministic-seed reproducibility guarantees; streaming multi-million-row loads.
- Truncate/replace-table-before-seed (insert-only; use existing delete/DDL paths separately).
