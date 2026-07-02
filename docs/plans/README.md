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
| [23](./phase-23-foreign-keys.md) | Foreign-key metadata + relational navigation | 📋 Planned |
| [24](./phase-24-schema-objects.md) | Broader schema-object browsing (views/functions/triggers/…) | 📋 Planned |
| [25](./phase-25-data-export-import.md) | Data export & import (CSV/JSON) | 📋 Planned |
| [26](./phase-26-query-plan-viz.md) | Query-plan visualization | 📋 Planned |
| [27](./phase-27-readonly-guardrails.md) | Read-only / environment connection guardrails | 📋 Planned |
| [28](./phase-28-ssh-tunneling.md) | SSH tunneling (needs §13 amendment) | 📋 Planned |
| [29](./phase-29-session-monitoring.md) | Active-session monitoring & kill-query | 📋 Planned |
| [30](./phase-30-audit-trail.md) | Mutation & DDL audit trail | 📋 Planned |
| [31](./phase-31-agentic-queries.md) | Agentic read-only query execution | 📋 Planned |
| [32](./phase-32-error-insights.md) | Error explanation & result insights | 📋 Planned |
| [33](./phase-33-ai-schema-suggestions.md) | AI schema-change suggestions | 📋 Planned |

Phases 0–5 are the **MVP** (complete). Phases 6–10 are the **first post-MVP wave** drawn from
[`../future-features.md`](../future-features.md) (all complete). Phases 11–22 are the **second
post-MVP wave** — two "strengthening" phases (11, 12) that harden already-built features, then the
remaining backlog (13–22); **all complete**, with the backlog now exhausted. Their sequencing lives
in [`roadmap-phase-11-22.md`](./roadmap-phase-11-22.md). Phases 23–33 are the **third wave** — a
fresh, backlog-independent set across three tracks (DBA depth, production safety/ops, AI depth),
sequenced in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md); all **planned**.

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
