# Prost — Phase 37: Column Profiling & Table Data Statistics

## Context

Prost shows a table's structure (columns, indexes, FKs — Phases 7/23) but nothing about its **data
shape**: how many rows, how many nulls, how many distinct values, the range, the common values. Answering
"is this column mostly null? how selective is it?" means hand-writing aggregate SQL. This phase adds an
**on-demand column-profiling panel** for the active table — computed in bounded SQL through the driver
seam — giving a quick data-quality/selectivity read (and useful grounding for the Phase-40 index advisor).
It is a DBA-depth slice depending on the existing metadata path (Phases 7/24).

Roadmap item: Phase 37 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md).

## Decisions (to confirm before building)

1. **Profiles are computed in SQL through the driver seam, capability-uniform (principles §1, §2).** A
   `buildColumnProfile(tableRef)` builder per driver (`pg`/`mysql`/`sqlite`) emits parameterized aggregate
   SQL (`COUNT`, `COUNT(DISTINCT)`, `MIN`/`MAX`, null counts, a `GROUP BY … LIMIT` top-N). Identifiers via
   `quoteIdent`; no engine branch in the feature service.
2. **Bounded and honest, never a full scan by default (principles §7, §11).** On large tables profiling
   **samples** (e.g. `TABLESAMPLE` on PG, a bounded `LIMIT`/`WHERE rowid` strategy elsewhere) and uses
   **approximate** row counts (catalog estimates) unless the user explicitly opts into an exact count. The
   result is clearly labeled as sampled/approximate; every profile query runs under the standard statement
   timeout.
3. **A narrow sibling result shape (principles §5, §6).** Profiles are a `ColumnProfile[]` /
   `TableProfile` in `@prost/shared-types` (per column: nullFraction, distinctCount/estimate, min, max,
   topValues), rendered in a profile panel — `GridResponse` does not grow profile fields.
4. **On-demand, explicit action (principle §7).** Profiling runs on an explicit "Profile" action (and
   per-column re-profile), never automatically on table open, so browsing stays cheap. No background
   collection.
5. **Read-only, safe on any connection (principle §4).** Profiling is pure read; it works on read-only and
   `prod` connections unchanged.

## Backend (`apps/api`)

### Driver + a profiling read (in `MetadataModule`)
- Add `buildColumnProfile` to each driver, aliasing to `ColumnProfile`; advertise sampling capability in
  the descriptor where relevant. A connection-scoped, ownership-guarded `GET …/tables/:schema/:table/profile`
  (optional `?exact=true`) that runs the bounded profile through `PoolManager.run` and maps timeouts/errors
  to specific classes (§11).

### Tests (Vitest, `apps/api`)
- `buildColumnProfile` returns the `ColumnProfile` shape per engine with parameterized SQL (no
  interpolation); sampling/approximate path used by default, exact only on opt-in; endpoint ownership
  enforced; timeout surfaced as a timeout error.

## Frontend (`apps/web` + `packages/ui`)

### Profile panel
- A **Profile** action in `TableStructurePanel` / the table toolbar opens a panel listing per-column
  null %, distinct count/estimate, min/max, and a small top-N distribution (token-styled bars), with a
  "sampled/approximate" badge and an "exact count" opt-in. Mobile parity as a full-width sheet (§9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The panel renders profiles from the response; the sampled/approximate badge shows; the exact-count opt-in
  re-requests; errors/timeouts surface a specific message.

## Verification

### Manual (demo target DBs)
1. Profile `users` → null %, distinct counts, min/max, and top values render; the "sampled" badge appears
   on a large table and exact-count opt-in works.
2. A high-cardinality column shows a high distinct estimate; a mostly-null column shows a high null %.
3. MySQL and SQLite profiles behave equivalently through their builders.
4. Profiling a `prod`/read-only connection works (pure read).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Full histograms / quantiles beyond a top-N distribution; cross-column correlations.
- Persisted or trend-over-time profiling (no background jobs — §13).
- Data-quality rule definitions / assertions.
