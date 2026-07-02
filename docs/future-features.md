# Prost — Future Features

A consolidated backlog of features identified as **meaningful but not yet built**, gathered
from prior UI reviews and the "out of scope / explicitly deferred" sections of the per-phase
plans ([`docs/plans/`](./plans/)). This file is a **backlog, not a plan** — when an item is
picked up, give it its own `docs/plans/phase-N-*.md` following the existing format (context,
decisions, backend/frontend work, verification, out-of-scope) and add it to
[`docs/plans/README.md`](./plans/README.md)'s status table.

Items are grouped by area. Each entry notes whether a UI affordance already exists (and where)
and links back to its source for full context where one exists.

> **Status (2026-07-02): this backlog is exhausted.** Every item below shipped in Phases 6–22 —
> the Stage 6–10 wave (connection-string import, schema view/edit, create table, AI chat) and the
> Phase 11–22 wave (reliability/abuse hardening, frontend test foundation, saved snippets, row
> filtering, multi-query tabs, multi-statement/`EXPLAIN`, IntelliSense, grid-editing depth, history
> management, global search, preferences/theming expansion, streaming results). All complete; see
> [`plans/README.md`](./plans/README.md) for the status table.
>
> The **next wave is Phases 23–33** — a fresh, backlog-independent set (this file fed nothing into
> it) across three tracks: DBA/power-user depth, production safety & ops, and AI depth. It is
> sequenced in [`plans/roadmap-phase-23-33.md`](./plans/roadmap-phase-23-33.md), with per-phase docs
> under [`plans/`](./plans/). The sections below are kept as **provenance** for the 6–22 wave; they
> no longer represent open work.

---

## Workspace / SQL editor

> **Owning phases:** multi-query tabs → [Phase 15](./plans/phase-15-multi-query-tabs.md);
> multi-statement/transactions/`EXPLAIN` → [Phase 16](./plans/phase-16-multi-statement-explain.md);
> autocomplete + formatting → [Phase 17](./plans/phase-17-editor-intellisense.md); streaming results
> → [Phase 22](./plans/phase-22-streaming-results.md); saved snippets + save-current-query →
> [Phase 13](./plans/phase-13-saved-snippets.md).

### Multi-query tabs ("+ New Query")
Open several query tabs at once, each with its own Monaco buffer, results grid, and run state.
Today `SqlEditorView` keeps its SQL/result/grid state in component-local `useState`, so
multiple query tabs would currently all render the *same* editor instance — this state needs
to move into `workspaceStore` (per-tab) before a `+` "New Query" affordance is meaningful.
**UI today:** none — the sole query tab's close button is hidden (`WorkspaceTabBar.tsx`) as a
minimal guard against the unrecoverable-empty-state trap.

### Saved snippets (Sidebar "Snippets" tab)
Persist named SQL snippets per user (new `Snippet` Prisma model + module mirroring
`HistoryModule`), list them in the Sidebar, click-to-load into Monaco, save-from-editor. Pairs
with "Save current query" below.
**UI today:** Sidebar "Snippets" tab exists, rendered disabled with a "Soon" badge
(`Sidebar.tsx`).
**Source:** `phase-3-sql-editor.md` / `phase-4-query-history.md` out-of-scope ("saving named
queries / snippets").

### Save current query → snippet
The natural entry point for the snippets feature above — "save the current query" as a named
snippet from the SQL editor toolbar.
**UI today:** none. The old TopBar "Save" icon was removed in the TopBar slimming pass; when
built, this belongs in the `SqlEditorView` toolbar next to Run, not the TopBar.

### Monaco autocomplete / schema-aware IntelliSense, query formatting
Suggest table/column names from the active connection's metadata while typing; format-on-save
or a format command.
**UI today:** none.
**Source:** `phase-3-sql-editor.md` out-of-scope.

### Multi-statement scripts, transactions, `EXPLAIN`
Run `BEGIN…COMMIT` blocks / multiple statements in one execution, and surface query plans for
`EXPLAIN`.
**UI today:** none — the editor and execution endpoint currently assume a single statement.
**Source:** `phase-3-sql-editor.md` out-of-scope.

### Streaming/cursor-based results beyond simple paging
For very large result sets, stream rows instead of the current offset/limit paging.
**UI today:** AG Grid's Infinite Row Model already paginates; this is a backend/protocol
change.
**Source:** `phase-3-sql-editor.md` out-of-scope.

---

## Table view / grid

> **Owning phases:** row filtering → [Phase 14](./plans/phase-14-row-filtering.md); everything else
> in this section (type-aware editors, multi-cell/bulk edits, undo/redo + optimistic concurrency,
> pin/group) → [Phase 18](./plans/phase-18-grid-editing-depth.md).

### Row filtering (column-level `WHERE` builder)
A filter popover per column that compiles to a parameterized `WHERE` clause fed into the
existing rows endpoint (`/connections/:id/tables/:schema/:table/rows`).
**UI today:** TableView toolbar "Filter" `IconButton` exists, rendered disabled with a
"Filtering — coming soon" tooltip (`TableView.tsx`).

### Multi-cell / whole-row transactional edits, bulk update, copy-paste ranges
Edit or paste across multiple cells/rows in one transactional request, rather than one cell at
a time.
**UI today:** none — current inline editing is single-cell, single-request.
**Source:** `phase-2-editing.md` out-of-scope.

### Undo/redo, optimistic-concurrency tokens / row versioning
Undo a recent cell edit/insert/delete; detect and surface concurrent-edit conflicts.
**UI today:** none.
**Source:** `phase-2-editing.md` out-of-scope.

### Type-aware cell editors
Date/time pickers, enum dropdowns, etc. beyond AG Grid's default text editors, driven by
column data types from metadata.
**UI today:** none — all columns use AG Grid's default editors.
**Source:** `phase-2-editing.md` out-of-scope.

### Column pinning / grouping
AG Grid feature-parity items (pin columns left/right, row grouping).
**UI today:** none.

---

## Schema management (DDL)

### View/edit schema and indexes
Surface index definitions per table (not just columns) in the schema tree/detail view, and
allow editing schema objects — column types/nullability, add/drop indexes — via generated DDL
executed through the existing `PgConnectionService` choke point.
**UI today:** `SchemaTree` is read-only (expand/collapse, select table); no index information
is surfaced and no DDL editing exists.
**Source:** user request (2026-06-12).

### Create table
A guided UI flow (or SQL scaffold) to create a new table — name, columns (name/type/
nullable/default), primary key — executed via parameterized DDL.
**UI today:** none — a table can currently only be created by writing a raw `CREATE TABLE`
statement in the SQL editor.
**Source:** user request (2026-06-12).

---

## Search & navigation

> **Owning phase:** global search → [Phase 20](./plans/phase-20-global-search.md).

### Global search
Workspace-wide search across schemas, tables, columns, and (maybe) history — client-side
fuzzy search over already-loaded metadata to start, server-backed later.
**UI today:** none. The old TopBar search input was removed in the TopBar slimming pass; when
built, this needs a new home (e.g. a command-palette-style overlay) rather than the slimmed
TopBar.

---

## Query history

> **Owning phase:** all history-management items → [Phase 19](./plans/phase-19-history-management.md).

### Editing, starring, deleting history entries
Manage history entries beyond the current read-only recent-queries list.
**UI today:** `QueryHistoryList` is click-to-load only.
**Source:** `phase-4-query-history.md` out-of-scope.

### Full-text search over history, cross-connection history views
Search history content; view history across all connections, not just the active one.
**UI today:** none.
**Source:** `phase-4-query-history.md` out-of-scope.

### Retention/pruning jobs, history export
Cap history growth and allow exporting it.
**UI today:** none.
**Source:** `phase-4-query-history.md` out-of-scope.

---

## Connection management

### Add connection via connection string
Accept a standard Postgres connection string (`postgres://user:password@host:port/database?sslmode=...`)
in `ConnectionModal` and parse it into the existing host/port/database/user/password/SSL
fields, as a faster alternative to filling each field in individually.
**UI today:** `ConnectionModal` only exposes individual fields.
**Source:** user request (2026-06-12).

---

## Theming / preferences

> **Owning phase:** all theming/preferences items → [Phase 21](./plans/phase-21-preferences-theming.md).

### Additional preference types
Font size, grid density, keybindings — beyond the current `colorMode`/`accentColor`.
**UI today:** `SettingsPanel` covers color mode + accent only.
**Source:** `phase-5-theming-responsiveness.md` out-of-scope (post-MVP).

### Per-connection or per-workspace theme overrides
Different theme per connection/workspace rather than one global preference.
**UI today:** none.
**Source:** `phase-5-theming-responsiveness.md` out-of-scope (post-MVP).

### Custom user-uploaded themes / palettes
Beyond the existing preset + custom-hex accent picker.
**UI today:** `ThemeSettings` offers `accentPresets` + custom hex only.
**Source:** `phase-5-theming-responsiveness.md` out-of-scope (post-MVP).

---

## AI / Assistance

> **Owning phase:** ✅ delivered in [Phase 10](./plans/phase-10-ai-chat-rag.md) (complete).

### Chat interface with RAG
A chat-style assistant for the connected database — answer questions, generate/explain SQL —
grounded via retrieval over schema metadata (and possibly query history).
**UI today:** delivered — `ChatPanel` in the collapsible right sidebar (desktop) / "AI" bottom-nav
tab (mobile), with user-managed `LlmEndpoint`s and "Load into editor" for SQL blocks.
**Source:** user request (2026-06-12). **Done:** Phase 10.

---

## Strengthening already-built features

Not feature requests — gaps found in a 2026-06-14 review of the shipped code. Captured here so
the backlog reflects *all* known work, not just new features.

> **Owning phases:** reliability & abuse hardening (login/AI throttling, target-DB pool lifecycle,
> editability fail-safe, single-statement invariant) → [Phase 11](./plans/phase-11-reliability-hardening.md);
> frontend test foundation (`apps/web` has zero tests today) →
> [Phase 12](./plans/phase-12-frontend-test-foundation.md).

### Rate limiting / abuse controls
`@nestjs/throttler` isn't installed; `POST /auth/login` (brute-force) and `POST :id/ai/chat`
(unbounded external-LLM cost) have no throttling. → Phase 11.

### Target-DB pool lifecycle
`PgConnectionService.pools` is keyed per connection and only evicted explicitly — no idle-TTL/LRU
reaping, `MAX_POOL_SIZE` hardcoded rather than config-driven. → Phase 11.

### Editability analyzer fail-safe + statement invariant
`query/editability.ts` must provably default to read-only on any SQL it can't fully prove maps to
one updatable base table; the implicit single-statement-per-execution assumption should be an
explicit, tested guard. → Phase 11.

### Frontend test coverage
`apps/web/src` has **no tests** vs. 14 API specs — the most user-facing logic (editability gating,
DDL modals, theme hydration, connection-string parse, chat load-into-editor) is unprotected. →
Phase 12.

---

## Suggested stages for recently-added features

> **Historical (superseded).** This block sequenced the Stage 6–10 wave, now **all complete**. For
> the next wave (Phases 11–22) see [`plans/roadmap-phase-11-22.md`](./plans/roadmap-phase-11-22.md).
> Kept for provenance.

A rough sequencing for the four features added above (connection string import, schema/index
viewing & editing, create table, AI chat with RAG), based on effort and dependency — not a
commitment. Numbering continues from `docs/plans/`'s completed phases (0-5), so the next
phase picked up from this backlog is **Stage 6**. Each stage now has a full plan under
[`docs/plans/`](./plans/) (linked below); see [`docs/plans/README.md`](./plans/README.md)'s
status table.

**Stage 6 — Connection string import** *(small, independent)* — [plan](./plans/phase-6-connection-string-import.md)
Parse a `postgres://user:pass@host:port/db?sslmode=...` string in `ConnectionModal` into the
existing host/port/database/user/password/SSL fields. Pure frontend (a small parser, likely
in `packages/utils`), no backend or schema changes. Can land any time, independent of
everything else here.

**Stage 7 — View schema & indexes** *(medium, read-only)* — [plan](./plans/phase-7-schema-index-viewing.md)
Extend the Metadata module/endpoint to include index definitions per table
(`pg_indexes`/`pg_index`), and extend `SchemaTree` / add a table-detail panel to show them.
Purely additive read queries through the existing `PgConnectionService` — no DDL execution
yet.

**Stage 8 — Create table** *(medium-large, foundational)* — [plan](./plans/phase-8-create-table.md)
The first DDL-*writing* feature: a form (table name, columns with type/nullable/default,
primary key) that generates a `CREATE TABLE` statement, previews it, and executes it through
`PgConnectionService` with identifiers validated via `quoteIdent` and types drawn from a
server-side allow-list. Establishes the **generate → preview → confirm → execute** DDL
pattern that Stage 9 reuses.

**Stage 9 — Edit schema & indexes** *(medium-large, depends on Stage 8)* — [plan](./plans/phase-9-edit-schema-indexes.md)
Alter column type/nullable/default, add/drop indexes, using the same
preview/confirm/execute pattern as Stage 8 (`ALTER TABLE` / `CREATE INDEX` / `DROP INDEX`).
Builds on Stage 7 (you need to see an index to drop it) and Stage 8's DDL pattern.

**Stage 10 — AI chat interface with RAG** *(largest, most novel)* — [plan](./plans/phase-10-ai-chat-rag.md)
Needs new infrastructure (LLM provider integration, retrieval over schema metadata and
possibly history) and its own design pass per the updated §13 — explicit decisions on what
context is sent to the model, logged separately from this backlog entry. Benefits from
Stage 7's richer metadata (index info improves grounding) but isn't blocked by Stages 8/9;
could proceed as an independent track if resourced separately.

**Suggested order:** Stage 6 any time; Stages 7 → 8 → 9 as one schema-management track;
Stage 10 as an independent track, ideally starting after Stage 7 lands.

---

## Not currently planned

The following are explicitly **out of scope until revisited** per
[`architecture-principles.md`](./architecture-principles.md) §13, listed here only for
context — they are not part of this backlog and have no UI affordance reserved for them:
non-Postgres engines, SSH tunneling, ER diagrams, team/multi-tenant features,
stored-procedure/trigger editors, advanced RBAC, query plans as a first-class feature,
background jobs/scheduling. Automated visual-regression/cross-browser testing infrastructure
is similarly deferred (`phase-5-theming-responsiveness.md`).

> §13 previously also listed "AI features" here; it's been updated so the chat/RAG entry
> above is tracked for upcoming development rather than excluded — subject to the same
> security/architecture principles as everything else (see §13).
