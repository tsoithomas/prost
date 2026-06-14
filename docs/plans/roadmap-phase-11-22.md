# Prost — Roadmap: Phases 11–22 (Post-MVP Wave 2)

Phases 0–10 are complete (MVP + the first post-MVP wave: connection-string import, schema
view/edit, create table, AI chat). This roadmap sequences **everything that remains** into
reviewable vertical slices, drawing from two sources:

1. **Hardening of already-built features** — gaps found in a 2026-06-14 review of the shipped
   code (see "Strengthening" below), not in any backlog yet.
2. **The remaining backlog** in [`../future-features.md`](../future-features.md) — the items
   that were *not* part of the Stage 6–10 wave.

Like [`README.md`](./README.md), this is the *how/when*; [`prost-mvp.md`](./prost-mvp.md) is the
*what* and [`../architecture-principles.md`](../architecture-principles.md) is the *rules*. Each
phase below has its own self-contained `phase-N-*.md` (same format as 0–10) and a row in the
README status table.

## The two threads

**Strengthening (built, needs hardening):**

- **No abuse/rate controls** — `/auth/login` (brute-force) and `POST :id/ai/chat` (unbounded
  external-LLM cost) have no throttling; `@nestjs/throttler` isn't installed. → **Phase 11**
- **Target-DB pool lifecycle** — `PgConnectionService.pools` is keyed per connection and only
  evicted explicitly; no idle TTL/LRU cap, `MAX_POOL_SIZE` hardcoded. → **Phase 11**
- **Editability analyzer fragility** — `query/editability.ts` decides if a result set is
  editable from SQL text; its fail-safe direction needs to be proven "read-only on doubt", with
  the single-statement assumption made an explicit, tested invariant. → **Phase 11**
- **Zero frontend tests** — `apps/web/src` has no tests at all (vs. 14 API specs). The most
  user-facing, highest-value code is the least protected. → **Phase 12**

**Remaining backlog features:** saved snippets, row filtering, multi-query tabs, multi-statement
/ transactions / `EXPLAIN`, schema-aware autocomplete + formatting, grid editing depth, query
history management, global search, expanded preferences/theming, and streaming large result
sets. → **Phases 13–22**

## Phases

| Phase | Scope | Thread | Size | Depends on |
| --- | --- | --- | --- | --- |
| [11](./phase-11-reliability-hardening.md) | Reliability & abuse hardening (throttling, pool lifecycle, editability fail-safe, statement invariant) | Strengthening | M | — |
| [12](./phase-12-frontend-test-foundation.md) | Frontend test foundation (Vitest + RTL harness, backfill high-value UI) | Strengthening | M | — |
| [13](./phase-13-saved-snippets.md) | Saved snippets (Sidebar tab + save-from-editor) | Feature | M | 12 |
| [14](./phase-14-row-filtering.md) | Row filtering (per-column `WHERE` builder) | Feature | M | 11 |
| [15](./phase-15-multi-query-tabs.md) | Multi-query tabs (workspace-state refactor) | Feature | M | 12 |
| [16](./phase-16-multi-statement-explain.md) | Multi-statement scripts, transactions, `EXPLAIN` | Feature | L | 11, 15 |
| [17](./phase-17-editor-intellisense.md) | Schema-aware autocomplete + query formatting | Feature | M | 15 |
| [18](./phase-18-grid-editing-depth.md) | Grid editing depth (type-aware editors, bulk/multi-cell, undo/redo, optimistic concurrency, pin/group) | Feature | L | 11 |
| [19](./phase-19-history-management.md) | Query history management (edit/star/delete, search, cross-connection, retention/export) | Feature | M | 13 |
| [20](./phase-20-global-search.md) | Global search (command-palette overlay) | Feature | M | 19 |
| [21](./phase-21-preferences-theming.md) | Preferences & theming expansion (font/density/keybindings, per-connection + custom themes) | Feature | M | — |
| [22](./phase-22-streaming-results.md) | Streaming / cursor-based large result sets | Feature | L | 16 |

## Recommended order & rationale

1. **Phase 11 → 12 first (foundations).** Hardening removes the two sharpest production risks
   (brute-force, runaway LLM cost) and nails down the statement invariant that Phases 16/22 build
   on. The web test harness lands next so **every feature phase after it ships with tests** — the
   discipline the API side already has.
2. **Phases 13 → 14 (quick wins).** Both have **UI placeholders already in the tree** (Sidebar
   "Snippets" tab; TableView "Filter" button) — small, independent, high visible payoff, and good
   first exercises of the new web-test harness.
3. **Phase 15 → 16 → 17 (SQL-editor track).** Multi-query tabs is a prerequisite refactor
   (per-tab state must leave `SqlEditorView`'s local `useState` before tabs, multi-statement, or
   per-tab IntelliSense are coherent); 16 then needs Phase 11's statement-invariant work.
4. **Phase 18 (grid track).** Independent depth work on the Phase 2 editing path; optimistic
   concurrency dovetails with Phase 11's write-path hardening.
5. **Phases 19 → 20 (history + navigation track).** History management reuses the snippets list
   patterns from 13; global search benefits from searchable history landing first.
6. **Phase 21 (preferences/theming)** any time — it only extends `PreferenceModule`/`themeStore`.
7. **Phase 22 last (largest perf change).** Streaming/cursor results is a backend protocol change
   that benefits from the execution model settled in Phase 16.

Independent tracks can be parallelized if resourced: {11}, {12}, {21}, and the {13→14} pair are
mutually independent; the editor track (15→16→17) and grid track (18) only converge on shared
types in `@prost/shared-types`.

## Invariants carried forward

Every phase below stays inside the existing rails: the two-database boundary (§1), parameterized
target SQL + `quoteIdent` (§2), server-decides/frontend-renders (§4), one grid contract (§5),
shared types as the single source of truth (§6), never load more than a page (§7), safe/reversible
mutations (§8), structural theming + mobile-first (§9), and honest, observable errors (§11/§12).
A phase is "done" only when its verification passes **and** it violates none of these.
