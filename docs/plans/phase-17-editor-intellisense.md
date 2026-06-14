# Prost — Phase 17: Schema-Aware Autocomplete & Query Formatting

## Context

The Monaco SQL editor today has theming and execution but no schema intelligence: no
table/column suggestions, no formatting. This phase adds **schema-aware IntelliSense** (suggest
schemas/tables/columns from the active connection's metadata while typing) and a **format
command**. It depends on **Phase 15** (per-tab editor state — completion is scoped to the active
tab's connection) and reuses the metadata already fetched for the schema tree (principle §7 — no
new bulk loads).

Backlog item: "Monaco autocomplete / schema-aware IntelliSense, query formatting" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **Completion is driven by already-cached metadata (principles §4, §7).** Register a Monaco
   `CompletionItemProvider` fed by the connection metadata the app already loads
   (`MetadataService` results cached client-side) — schemas, tables, columns, and their types. No
   new endpoint and no "load everything"; if metadata for a schema isn't loaded yet, completion
   degrades gracefully (keywords only) rather than triggering a heavy fetch.
2. **Context-aware where cheap, keyword-complete always.** v1 offers: SQL keyword completion;
   table/schema names after `FROM`/`JOIN`/`UPDATE`/`INTO`; column names for tables in scope
   (best-effort parse of the `FROM` list). Perfect scope resolution is explicitly *not* required —
   over-suggesting is acceptable, wrong-and-confident is not.
3. **Formatting is local and deterministic.** Use a SQL formatter library (e.g. `sql-formatter`)
   behind a "Format" command/keybinding; it never changes semantics, only layout. Format-on-save
   is offered as an opt-in preference (ties into Phase 21) — default off so it never surprises.
4. **No provider/LLM involvement.** This is purely metadata + a formatter — distinct from the AI
   chat (Phase 10). No external calls, nothing leaves the browser (principle §3).
5. **Lives in `packages/ui` editor layer where it's reusable.** The completion provider and
   formatter wiring sit with the Monaco theme/config in `packages/ui/src/editor/` (mind the
   Tailwind `@source` content-scanning note if any UI is added), fed connection metadata by the
   web app.

## Backend (`apps/api`)

None — metadata endpoints already exist (Phases 1/7). No new shared types unless the cached
metadata shape needs a small addition for completion (reuse existing `MetadataDto` shapes,
principle §6).

## Frontend (`apps/web` + `packages/ui`)

### Completion provider
- A `registerSqlCompletion(monaco, getMetadata)` in `packages/ui/src/editor/` registering a
  `CompletionItemProvider` for the SQL language. The web app supplies a `getMetadata()` closure
  reading the active connection's cached metadata (schemas/tables/columns/types).
- Suggestion ranking: in-scope columns > tables > schemas > keywords; show column type as detail.
- Re-bind when the active connection/tab changes (Phase 15); dispose providers on unmount to avoid
  leaks/duplicate registration.

### Formatting
- Add `sql-formatter` (or similar); a "Format SQL" command bound to a keybinding and a toolbar
  action in `SqlEditorView`; format the active tab's buffer in place.
- Wire an opt-in "format on save/run" preference placeholder (full preference UI is Phase 21).

### Tests (Vitest, `apps/web`/`packages/ui` — per Phase 12)
- Given mock metadata, the provider returns the expected table/column items after `FROM`;
  degrades to keywords when metadata is absent; formatting a known-ugly query yields the expected
  normalized text and doesn't alter token semantics.

## Verification

### Manual (demo target DB, port 5434)
1. Type `SELECT * FROM ` → suggestions list real tables (users/orders/products).
2. Type `SELECT u. FROM users u` style → column suggestions for the table in scope, with types.
3. With no metadata loaded for a schema → keyword completion still works, no janky fetch.
4. Run "Format SQL" on a messy query → tidy, semantically-identical SQL.
5. Switch connection/tab → suggestions reflect the new connection's schema, no stale entries.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Full SQL parser-grade scope resolution (CTE aliases, sub-select scoping) — best-effort in v1.
- Signature help for functions, snippet-style parameter completion.
- Linting/diagnostics (error squiggles) in the editor.
- AI-assisted completion — that's the Phase 10 chat track, kept separate.
