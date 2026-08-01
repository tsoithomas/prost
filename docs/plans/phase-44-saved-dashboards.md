# Prost — Phase 44: Saved Dashboards / Pinned Result Charts

## Context

Phase 29 added result-insight charts rendered over the loaded page, but a chart vanishes when you run the
next query — there is no way to save or revisit one. This phase lets a user **save a chart together with
its query** as a named, pinnable tile and arrange several on a simple **dashboard** tab. It reuses the
Phase-29 chart rendering and mirrors the Phase-13 snippet persistence model (app-DB, per-user). It is a
DBA-depth/enrichment slice depending on Phases 29 and 13. Crucially, a saved tile stores **a query + a
chart spec — never target rows** (§1), exactly as snippets store SQL text.

Roadmap item: Phase 44 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md).

## Decisions (to confirm before building)

1. **A saved tile is a query + chart spec, never data (principle §1).** Persist a `SavedChart` (app-DB
   Prisma model mirroring `Snippet`): name, connectionId, `sql` (text/identifiers only), and a
   `ChartSpec` (chart type, x/series/agg selections from Phase 29). **No result rows** are stored — opening
   a tile **re-runs** the saved query. Same boundary posture as snippets/history.
2. **Charts still render over a loaded page (principle §7).** Opening/refreshing a tile runs the saved
   query through the existing read path and charts the **loaded page** (Phase 29) — no whole-table
   server-side aggregation, no unbounded read.
3. **Reuse the Phase-29 chart, don't fork it (principle §5).** Tiles render the existing `ResultChart`
   from the loaded `GridResponse`; the dashboard is a layout of these, not a new charting engine.
4. **A dashboard is a simple per-user layout (principles §6, §9).** A `Dashboard` model (name + ordered
   `SavedChart` references) with CRUD mirroring `SnippetModule`; the dashboard tab lays tiles out
   responsively (grid on desktop, stacked on mobile). Single-user — no sharing.
5. **Save-from-chart is the entry point (principle §8).** A "Save chart" action on the Phase-29 chart panel
   captures the current `sql` + `ChartSpec`; nothing is auto-saved.

## Backend (`apps/api`)

### `SavedChartModule` / `DashboardModule` (mirroring `SnippetModule`)
- Prisma `SavedChart` + `Dashboard` models (app DB); connection/user-scoped, ownership-guarded CRUD.
  Stores SQL text + `ChartSpec` JSON only (validated shape), never result data. `ChartSpec` lives in
  `@prost/shared-types` (shared with Phase 29).

### Tests (Vitest, `apps/api`)
- CRUD round-trips a `SavedChart`/`Dashboard`; only SQL + spec persisted (no rows); ownership enforced;
  invalid `ChartSpec` → 400.

## Frontend (`apps/web` + `packages/ui`)

### Save + dashboard tab
- "Save chart" on the Phase-29 chart panel opens a small name dialog → creates a `SavedChart`. A
  **Dashboard** workspace tab lists dashboards and renders their tiles (each re-runs its query and draws
  `ResultChart`), with add/remove/reorder tiles and a per-tile refresh. Mobile: stacked full-width tiles.

### Tests (Vitest, `apps/web` — per Phase 12)
- Saving a chart persists sql + spec; the dashboard renders tiles by re-running their queries; reorder/
  remove work; a tile with a failing query surfaces a specific error (not a blank).

## Verification

### Manual (demo target DBs)
1. Run a query, chart it (Phase 29), **Save chart** → it appears on a dashboard tile and re-draws by
   re-running the query.
2. Add several tiles, reorder them; reload the app → the dashboard persists (query + spec only; confirm no
   rows are stored).
3. Open the dashboard on mobile → tiles stack full-width; a tile whose table changed shows an honest error.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Scheduled / auto-refreshing dashboards (no background jobs — §13); sharing dashboards (single-user).
- Server-side whole-table aggregation for charts (loaded-page only — §7); chart image export.
- Cross-connection dashboards mixing multiple connections in one tile.
