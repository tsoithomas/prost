# Prost — Phase Plans

Per-phase implementation plans for Prost, derived from [`prost-mvp.md`](./prost-mvp.md) §4
and bound by [`../architecture-principles.md`](../architecture-principles.md). The MVP spec
is the *what*; the principles are the *rules*; these files are the *how* for each reviewable
checkpoint.

Each plan is self-contained: context, confirmed decisions, backend work, frontend work,
verification, and explicit out-of-scope. A phase is "done" only when its verification section
passes **and** it violates none of the architecture principles.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| [0](./phase-0-scaffold.md) | Scaffold & infra (pnpm/Turborepo, Docker, design-system shell) | ✅ Complete |
| [1](./phase-1-vertical-slice.md) | Vertical slice: login → connection → schema tree → table rows | ✅ Complete |
| [2](./phase-2-editing.md) | Inline editing: cell update, insert row, delete row | ✅ Complete |
| [3](./phase-3-sql-editor.md) | SQL editor + editability analyzer | ✅ Complete |
| [4](./phase-4-query-history.md) | Query history | ✅ Complete |
| [5](./phase-5-theming-responsiveness.md) | Theming & responsiveness hardening | ✅ Complete |
| [6](./phase-6-connection-string-import.md) | Connection string import (paste a Postgres URI) | ✅ Complete |
| [7](./phase-7-schema-index-viewing.md) | View schema & indexes (table structure panel) | ✅ Complete |
| [8](./phase-8-create-table.md) | Create table (first DDL write; preview→confirm→execute) | ✅ Complete |
| [9](./phase-9-edit-schema-indexes.md) | Edit schema & indexes (alter columns, add/drop indexes) | ✅ Complete |
| [10](./phase-10-ai-chat-rag.md) | AI chat assistant with metadata-grounded RAG | ✅ Complete |
| [11](./phase-11-reliability-hardening.md) | Reliability & abuse hardening (throttling, pool lifecycle, editability fail-safe) | ✅ Complete |
| [12](./phase-12-frontend-test-foundation.md) | Frontend test foundation (Vitest + RTL harness) | ✅ Complete |
| [13](./phase-13-saved-snippets.md) | Saved snippets (Sidebar tab + save-from-editor) | ✅ Complete |
| [14](./phase-14-row-filtering.md) | Row filtering (per-column `WHERE` builder) | ✅ Complete |
| [15](./phase-15-multi-query-tabs.md) | Multi-query tabs (workspace-state refactor) | ✅ Complete |
| [16](./phase-16-multi-statement-explain.md) | Multi-statement scripts, transactions, `EXPLAIN` | ✅ Complete |
| [17](./phase-17-editor-intellisense.md) | Schema-aware autocomplete + query formatting | ✅ Complete |
| [18](./phase-18-grid-editing-depth.md) | Grid editing depth (type-aware editors, bulk edits, undo/redo, pin/group) | ✅ Complete |
| [19](./phase-19-history-management.md) | Query history management (edit/star/delete, search, export) | ✅ Complete |
| [20](./phase-20-global-search.md) | Global search (command-palette overlay) | ✅ Complete |
| [21](./phase-21-preferences-theming.md) | Preferences & theming expansion | ✅ Complete |
| [22](./phase-22-streaming-results.md) | Streaming / cursor-based large result sets | ✅ Complete |
| [23](./phase-23-foreign-keys.md) | Foreign-key metadata + relational navigation | ✅ Complete |
| [24](./phase-24-schema-objects.md) | Broader schema-object browsing (views/functions/triggers/…) | ✅ Complete |
| [25](./phase-25-readonly-guardrails.md) | Read-only / environment connection guardrails | ✅ Complete |
| [26](./phase-26-query-plan-viz.md) | Query-plan visualization | ✅ Complete |
| [27](./phase-27-session-monitoring.md) | Active-session monitoring & kill-query | ✅ Complete |
| [28](./phase-28-audit-trail.md) | Mutation & DDL audit trail | ✅ Complete |
| [29](./phase-29-error-insights.md) | Error explanation & result insights | ✅ Complete |
| [30](./phase-30-data-export-import.md) | Data export & import (CSV/JSON) | ✅ Complete |
| [31](./phase-31-agentic-queries.md) | Agentic read-only query execution | ✅ Complete |
| [32](./phase-32-ssh-tunneling.md) | SSH tunneling | ✅ Complete |
| [33](./phase-33-ai-schema-suggestions.md) | AI schema-change suggestions | ✅ Complete |
| [34](./phase-34-settings-redesign.md) | Settings & preferences redesign (unified modal + fine-tune styling) | ✅ Complete |
| [35](./phase-35-accessibility-hardening.md) | Accessibility & keyboard-navigation hardening | ✅ Complete |
| [36](./phase-36-er-diagram.md) | ER diagram / relationship visualization | ✅ Complete |
| [37](./phase-37-column-profiling.md) | Column profiling & table data statistics | 🔲 Planned |
| [38](./phase-38-object-comments.md) | Table & column documentation (native comments) | 🔲 Planned |
| [39](./phase-39-data-masking.md) | Data masking / sensitive-column redaction | 🔲 Planned |
| [40](./phase-40-perf-insights.md) | On-demand query-performance insights & index advisor | 🔲 Planned |
| [41](./phase-41-schema-diff.md) | Schema comparison & migration diff (live-vs-live) | 🔲 Planned |
| [42](./phase-42-data-generation.md) | Data generation / test-data seeding | 🔲 Planned |
| [43](./phase-43-saved-dashboards.md) | Saved dashboards / pinned result charts | 🔲 Planned |
| [44](./phase-44-grid-conflict-detection.md) | Grid concurrency: optimistic-conflict detection | 🔲 Planned |
| [45](./phase-45-ai-query-rewrite.md) | AI query-optimization & rewrite advisor | 🔲 Planned |
| [46](./phase-46-ai-data-editing.md) | AI-assisted data editing with preview | 🔲 Planned |

Phases 0–5 are the **MVP** (complete). Phases 6–10 are the **first post-MVP wave** drawn from
[`../future-features.md`](../future-features.md) (all complete). Phases 11–22 are the **second
post-MVP wave** — two "strengthening" phases (11, 12) that harden already-built features, then the
remaining backlog (13–22); **all complete**, with the backlog now exhausted. Their sequencing lives
in [`roadmap-phase-11-22.md`](./roadmap-phase-11-22.md). Phases 23–33 are the **third wave** — a
fresh, backlog-independent set across three tracks (DBA depth, production safety/ops, AI depth),
sequenced in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md). Phases 23–33 are **all complete**
(FK metadata + relational navigation, read-only schema-object browsing, read-only/environment
guardrails, query-plan visualization, active-session monitoring, a mutation & DDL audit trail, error
explanation + result-insight charts, streaming CSV/JSON data export & import, agentic read-only query
execution, SSH tunneling, and AI schema-change suggestions) — the third wave is now **exhausted**.
Phases 34–46 are the **fourth wave** — a "depth within the rails" set that stays single-user and
self-hosted (no team/multi-tenant, RBAC, new engines, or background jobs), mixing new features (ER diagram,
column profiling, native-comment documentation, data masking, on-demand perf/index advisor, schema diff,
data generation, saved dashboards, AI query-rewrite and AI-assisted data editing) with strengthening of
shipped features (a redesigned settings experience, accessibility hardening, and grid concurrency
detection). It is sequenced in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md); every hard dependency
lands on an already-complete phase, and its only §13 amendment unfreezes ER diagrams. **Phases 34–36 are
complete**: the settings/preferences redesign; the accessibility & keyboard-navigation pass (a visible
focus ring, the shared `Modal` adopted across all dialogs, ARIA on the tab bar / schema tree / command
palette / bottom nav, an expanded keyboard-shortcut registry with a help overlay, and automated `axe-core`
checks); and the read-only ER diagram (a schema-wide `buildListSchemaForeignKeys` driver read behind
`GET :id/schemas/:schema/foreign-keys`, a dependency-free layered layout in `workspace/erLayout.ts`, and an
`'erDiagram'` workspace tab rendering `ErDiagramView` — pan/zoom, node → open table, edge → constraint
detail, no DDL and no persisted layout). **Phases 37–46 are planned**.

## Sequencing notes

- Phases are **vertical slices**: each ends at a state a user (and reviewer) can exercise
  end-to-end, not a horizontal layer.
- Several cross-boundary types for later phases already exist in `@prost/shared-types`
  (`RowUpdateRequest`, `RowInsertRequest`, `RowDeleteRequest`, `QueryResult`,
  `QueryHistoryDto`, `UserPreferenceDto`) and all Prisma models
  (`User`/`Connection`/`QueryHistory`/`UserPreference`) are already in
  `apps/api/prisma/schema.prisma`. Future phases wire these up rather than introducing the
  shapes from scratch — adjust them in `shared-types` if a contract needs to change, never
  hand-redeclare on one side (principle §6).
- Phase 5 (theming/responsiveness) is woven through every phase as it lands; the dedicated
  plan is the final hardening + audit pass, not the first time these concerns appear.
