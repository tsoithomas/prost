# Prost — Roadmap: Phases 34–46 (Fourth Wave — Depth Within the Rails)

Phases 0–33 are complete — the MVP (0–5), the first post-MVP wave (6–10), the second wave (11–22), and
the third wave (23–33, three tracks: DBA depth, production safety/ops, AI depth). Both the planned backlog
in [`../future-features.md`](../future-features.md) and the third-wave roadmap
[`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md) are **exhausted**.

This roadmap sequences the **fourth wave**, chosen from an explicit product steer rather than a
pre-existing backlog:

- **Deepen within the current rails.** Stay a **single-user, self-hosted** internal tool — **no**
  team/multi-tenant, **no** RBAC, **no** new engines, **no** background jobs/scheduling. Every phase is
  **on-demand/interactive** and rides an existing seam.
- **Mix new features with strengthening.** New capability (ER diagram, schema diff, perf/index advisor,
  data masking, data generation, saved dashboards, AI data editing) sits alongside hardening of shipped
  features (a redesigned settings experience, accessibility, grid concurrency, richer AI advice).
- **Amend `architecture-principles.md` §13 first, item-by-item**, only where a feature needs it — a
  dedicated docs change, per §13's own change rule.

Like [`README.md`](./README.md), this is the *how/when*; [`prost-mvp.md`](./prost-mvp.md) is the *what*
and [`../architecture-principles.md`](../architecture-principles.md) is the *rules*. Each phase below has
its own self-contained `phase-N-*.md` (same format as 0–33) and a row in the README status table.

## Governance step — §13 amendment (do first)

`architecture-principles.md` §13 froze "ER diagrams" among other items. This wave needs **one** narrow
amendment, in a dedicated docs change, per §13's change rule:

- **Unfreeze ER diagrams** (Phase 36). Flagged as an unfrozen candidate in
  [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md) once FK metadata (Phase 23) landed. New rule: an
  ER diagram is a **read-only rendering** of the same server-validated `ForeignKeyMetadata` the app
  already surfaces — no write or execute path (§1/§4), a *narrow sibling view*, never a forked grid (§5).
  Interactive navigation reuses the Phase-23 relational-navigation path. *Editing* relationships from the
  diagram (FK-constraint DDL) and persisting layouts stay frozen.

The **settings-redesign** (Phase 34) needs **no** amendment — it re-organizes and extends existing
preferences through the existing `PreferenceModule`/`themeStore` seam, an internal-health/UX improvement
§13 already permits (§13's "internal health" carve-out).

**Still frozen** (matches the single-user steer): team/multi-tenant, shared connections, advanced RBAC,
SaaS, additional engines (MariaDB, SQL Server, Oracle), background jobs/scheduling, and
stored-procedure/trigger **editing or execution**.

## Phases

| Phase | Scope | Track | Size | Depends on |
| --- | --- | --- | --- | --- |
| [34](./phase-34-settings-redesign.md) | Settings & preferences redesign (unified modal + fine-tune styling) | Strengthening | L | — |
| [35](./phase-35-accessibility-hardening.md) | Accessibility & keyboard-navigation hardening | Strengthening | M | — |
| [36](./phase-36-er-diagram.md) | ER diagram / relationship visualization | A · DBA depth | M | §13 amend, 23 |
| [37](./phase-37-column-profiling.md) | Column profiling & table data statistics | A · DBA depth | M | 7, 24 |
| [38](./phase-38-object-comments.md) | Table & column documentation (native comments) | A · DBA depth | M | 24, 8, 9 |
| [39](./phase-39-data-masking.md) | Data masking / sensitive-column redaction | B · Safety/ops | M | 30 |
| [40](./phase-40-perf-insights.md) | On-demand query-performance insights & index advisor | A · DBA depth | L | 26, 27, 33 |
| [41](./phase-41-schema-diff.md) | Schema comparison & migration diff (live-vs-live) | A · DBA depth | L | 24, 8, 9, 33 |
| [42](./phase-42-data-generation.md) | Data generation / test-data seeding | A · DBA depth | M | 30, 25 |
| [43](./phase-43-saved-dashboards.md) | Saved dashboards / pinned result charts | A · DBA depth | M | 29, 13 |
| [44](./phase-44-grid-conflict-detection.md) | Grid concurrency: optimistic-conflict detection | Strengthening | M | 2, 18 |
| [45](./phase-45-ai-query-rewrite.md) | AI query-optimization & rewrite advisor | C · AI depth | M | 26, 31, 33 |
| [46](./phase-46-ai-data-editing.md) | AI-assisted data editing with preview | C · AI depth | L | 25, 31, 33, 45 |

*(Optional, unscheduled)* **E2E / headless-browser test harness (Playwright)** — functional flows against
the demo DBs, complementing the Phase 12 unit harness. A worthwhile candidate, not a numbered phase in
this wave; Phase 35 instead adds an `axe-core` check inside the existing Vitest+RTL harness (no browser
infra needed).

## Recommended order & rationale

The phases are **numbered in implementation order** — build them in ascending order and every
`Depends on` is satisfied. All hard dependencies land on **already-complete** phases (0–33); the only
intra-wave dependency is 46→45. The numbering encodes:

1. **§13 amendment first.** A short docs change that unblocks Phase 36 (ER diagram). Cheap, and the
   principles doc requires it before the code.
2. **Strengthening foundations early — Phases 34, 35.** No dependencies. Phase 34 extracts the shared
   `Modal`/`Tabs` primitives (today ~10 modals are hand-rolled) and establishes the accessible-modal
   reference; Phase 35 generalizes its a11y patterns and adds an automated `axe-core` check. Both pay off
   across every later phase's UI.
3. **Independent DBA/ops slices — Phases 36, 37, 38, 39 — scheduled by appetite.** None block each other;
   each is a self-contained slice with visible payoff (diagram, profiling, docs, masking).
4. **Composed slices — Phases 40, 41, 42, 43.** Each reuses an earlier *pattern* (40/41 reuse Phase 33's
   suggestion→preview routing; 42 reuses Phase 30's batched insert; 43 reuses Phase 29 charts + Phase 13
   persistence), so they sit after their (already-shipped) pattern sources and after the simpler siblings.
5. **Grid strengthening — Phase 44** — hardens the edit path the AI-data phase leans on.
6. **AI depth last — Phases 45 then 46.** 45 establishes request-time AI-write *suggestion*; 46 (the
   capstone) reuses it and the whole confirm-gated write pipeline to propose *data* changes.

Tracks A/B/C + strengthening can be resourced in parallel; they converge only on shared types in
`@prost/shared-types`. Since the numbers encode the order, take them in sequence.

## Invariants carried forward

Every phase stays inside the existing rails: the two-database boundary (§1) — **no target schema or row
data in the app DB** (schema-diff compares two live connections in memory; saved dashboards store a query
+ chart spec, i.e. SQL text/identifiers only, as snippets already do; table/column documentation is
written to the *target* DB as native comments); parameterized target SQL + `quoteIdent` (§2);
server-decides/frontend-renders (§4) — masking, conflict tokens, and index/rewrite/data suggestions are
all re-validated server-side; one grid contract (§5) — ER diagram, profiling, and dashboards are narrow
siblings, never a forked grid; shared types as the single source of truth (§6); never load more than a
page (§7) — profiling samples, charts use the loaded page, generation is capped; safe/reversible mutations
behind confirm gates (§8) — every write and DDL stays behind a confirm gate and never auto-applies;
structural theming + mobile-first (§9); honest, observable errors + audit (§11/§12) — no credentials or
row values ever leave the seam. Only §13 is amended, and only for ER diagrams. A phase is "done" only when
its verification passes **and** it violates none of these.
