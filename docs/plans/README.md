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
