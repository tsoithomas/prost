# Prost — Phase 26: Query-Plan Visualization

## Context

Phase 16 added `EXPLAIN` execution and each driver already has a `formatExplain` that renders a plan
as text. This phase turns that into a **visual, navigable plan** — a cost/timing tree that makes hot
nodes (sequential scans, high row estimates, expensive sorts) obvious. It also adds
`EXPLAIN ANALYZE` (actual timings) as an explicit, opt-in action.

It is **mostly frontend**: the backend already produces plan output; this phase asks each driver for
a **structured** plan (PostgreSQL `EXPLAIN (FORMAT JSON)`) and renders it in a new result-panel
variant within the same workspace shell (principle §5 — the grid contract is untouched; a plan is a
sibling view, not a forked grid). It depends on nothing.

Roadmap item: Phase 26 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **Structured plans come from the driver, parsed on the client (principles §1, §4).** PostgreSQL
   returns `EXPLAIN (FORMAT JSON)` — a real tree the frontend renders without re-deriving costs.
   MySQL returns `EXPLAIN FORMAT=JSON`; SQLite's `EXPLAIN QUERY PLAN` is a flat step list rendered
   as a simple tree. Each driver advertises `supportsExplainJson` / `supportsExplainAnalyze` in its
   descriptor; the frontend renders whatever shape the descriptor says the engine produces. No
   feature-service engine branch.
2. **A narrow sibling result shape, not a bloated `GridResponse` (principle §5).** A plan is returned
   as its own `QueryPlanResult` in `@prost/shared-types` (root node + children, each with
   `nodeType`, `estimatedCost`, `estimatedRows`, and optional `actualTime`/`actualRows` under
   ANALYZE). The workspace renders it in a plan panel; `GridResponse` does not grow plan fields.
3. **`EXPLAIN ANALYZE` is explicit and honest about side effects (principles §8, §11).** Because
   `ANALYZE` actually **runs** the statement, it is a separate, clearly-labelled action, gated by
   `useConfirm` for non-`SELECT` statements (an `ANALYZE` of an `UPDATE` mutates data), and blocked
   entirely on read-only connections (Phase 27). Plain `EXPLAIN` (estimate only) needs no gate.
4. **Editing/execution semantics are unchanged.** Running `EXPLAIN` produces a plan panel, never an
   editable grid; the editability analyzer is not involved. The normal query path is untouched — this
   is an additional lens on the same statement.
5. **Visualization highlights, doesn't advise (this phase).** Nodes are color/heat-weighted by
   relative cost/time and expandable, with per-node detail. AI-driven *suggestions* from a plan are a
   separate slice (Phase 33), routed through the DDL preview pipeline.

## Backend (`apps/api`)

### Driver + `QueryService`
- Add `buildExplain(sql, { analyze, format })` (or extend the existing explain path) so each driver
  returns its structured plan; advertise `supportsExplainJson`/`supportsExplainAnalyze` on the
  descriptor. Keep `formatExplain` as the text fallback for engines/paths without JSON.
- `QueryService` returns a `QueryPlanResult` for explain requests; `ANALYZE` requests are rejected on
  read-only connections (Phase 27) and run under the normal statement timeout (principle §3).

### Tests (Vitest, `apps/api`)
- PG returns a parseable JSON plan tree; MySQL JSON plan parsed; SQLite step-list mapped to the tree
  shape; `supports*` flags gate the request; `ANALYZE` on a read-only connection → rejected; text
  fallback still works.

## Frontend (`apps/web` + `packages/ui`)

### Plan panel
- A new **Query Plan** result-panel variant (sibling to the grid in the workspace shell): renders the
  `QueryPlanResult` as an expandable tree, nodes heat-weighted by cost/actual time, with a per-node
  detail popover. An **Explain** and (descriptor-permitting) **Explain Analyze** action live next to
  Run in the editor toolbar. Token-driven colors (principle §9); the heat scale uses `--color-data-*`
  / accent tokens, no hardcoded hex.
- Mobile: the tree is vertically scrollable with touch-expand; the panel takes the results slot.

### Tests (Vitest, `apps/web` — per Phase 12)
- A JSON plan renders as the expected node tree; the heat weighting reflects relative cost; the
  Analyze action is hidden when the descriptor lacks `supportsExplainAnalyze`; Analyze confirms on a
  mutating statement.

## Verification

### Manual (demo target DBs)
1. PostgreSQL: `EXPLAIN` a join query → tree renders with node types, costs, row estimates; the most
   expensive node stands out.
2. `EXPLAIN ANALYZE` the same query → actual times/rows appear; confirm the gate fires on an
   `UPDATE … ` analyze and is blocked on a read-only connection.
3. MySQL: an `EXPLAIN FORMAT=JSON` plan renders; SQLite: `EXPLAIN QUERY PLAN` steps render as a
   simple tree.
4. The normal grid/editability behavior is unchanged when running the query itself.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- AI-generated optimization suggestions from a plan (Phase 33).
- Plan diffing / history of plans over time.
- Auto-`EXPLAIN` on every query (opt-in action only, to avoid doubling query load — §7).
- Index-usage advisor beyond visual highlighting.
