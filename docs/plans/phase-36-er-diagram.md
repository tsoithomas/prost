# Prost — Phase 36: ER Diagram / Relationship Visualization

## Context

Phase 23 surfaced foreign-key metadata end-to-end (`ForeignKeyMetadata`, `buildListForeignKeys` /
`buildListReferencingForeignKeys`) and added cell-level relational navigation, but relationships are only
ever seen one edge at a time. This phase renders a schema's tables and their FK relationships as an
**interactive, read-only ER diagram** — the classic "show me how these tables connect" view — reusing the
metadata the app already fetches. It is a DBA-depth feature, **mostly frontend**, and adds no new data
path: it is the read-only rendering the §13 amendment unfreezes. It depends on Phase 23.

Roadmap item: Phase 36 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md). Requires the §13 amendment
(ER diagrams unfrozen).

## Decisions (to confirm before building)

1. **A read-only rendering of existing FK metadata, no new data (principles §1, §4).** Nodes are the
   schema's tables (from `MetadataService.getSchemas`), edges are `ForeignKeyMetadata` from the Phase-23
   driver builders. Nothing new is queried from the target beyond what schema browsing already loads; the
   server remains the source of truth for the graph.
2. **A narrow sibling view, never a forked grid (principle §5).** The diagram opens as its own workspace
   tab / panel in the existing shell (like `QueryPlanView` / `DefinitionPanel`), rendered from
   already-fetched metadata. `GridResponse` is untouched.
3. **Interactive navigation reuses Phase 23 (principle §4).** Click a node → open that table
   (`workspaceStore`); click/hover an edge → its FK detail, and "show referencing/referenced rows" routes
   through the **existing** Phase-23 relational-navigation path (`buildFkNavTargets` → `presetFilter`). No
   new navigation logic.
4. **Bounded, client-rendered, themed (principles §7, §9).** The diagram is scoped to the **current
   schema** (bounded, not the whole server), auto-laid-out and pan/zoom-able, rendered client-side as
   SVG/canvas with **no external CDN** (self-contained). It is token-themed (light/dark/accent) and has a
   usable mobile fallback (e.g. a simplified/scrollable layout).
5. **Read + navigate only (principle §13).** No editing relationships from the diagram (that is
   FK-constraint DDL, gated as ever), no persisted layouts, no cross-schema/whole-server map.

## Backend (`apps/api`)

Minimal / none beyond Phase 23. The diagram consumes the existing `GET :id/metadata` schema tree
(tables + columns) and the Phase-23 `foreignKeys` already attached to table structure. If a single
schema-wide FK fetch is cleaner than per-table, add one thin capability-uniform read that composes the
existing `buildListForeignKeys` per table (no new SQL patterns, driver seam only — principle §1).

### Tests (Vitest, `apps/api`)
- If a schema-wide FK aggregation endpoint is added: it returns `ForeignKeyMetadata` per engine via the
  existing builders, ownership-guarded, with no engine branch in the feature service.

## Frontend (`apps/web` + `packages/ui`)

### `ErDiagramView`
- A new workspace view (`'er-diagram'` tab kind, routed like the Phase-24 `'object'` tab) that lays out
  table nodes + FK edges with a small dependency-free auto-layout, pan/zoom, and click-through: node →
  open table, edge → FK detail + Phase-23 relational navigation. Token-styled, dark-mode aware, mobile
  fallback. Entry points: a "Diagram" action on the schema/database overview and per-schema in the tree.

### Tests (Vitest, `apps/web` — per Phase 12)
- The view renders one node per table and one edge per FK from metadata; clicking a node opens the table
  tab; an edge triggers the Phase-23 navigation; empty/relation-less schemas render gracefully; the view
  is hidden/adapted on mobile per the fallback.

## Verification

### Manual (demo target DBs)
1. Open the ER diagram for the demo Postgres schema → `users`/`orders`/`products` appear as nodes with FK
   edges (`orders.user_id → users.id`, etc.); pan/zoom works.
2. Click a node → the table opens in the grid; click an edge's "show referencing rows" → the Phase-23
   filtered view opens.
3. MySQL (composite-key `order_items`) renders its edges; SQLite renders its FK graph.
4. Toggle dark mode → the diagram re-themes; open it on a ~360px viewport → the mobile fallback is usable.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Editing relationships from the diagram (FK-constraint DDL stays gated — §13); persisted/custom layouts.
- Cross-schema or whole-server maps; column-level lineage; non-FK inferred relationships.
- Exporting the diagram as an image (view-only).
