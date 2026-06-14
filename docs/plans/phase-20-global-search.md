# Prost — Phase 20: Global Search (Command Palette)

## Context

The old TopBar search input was removed in the TopBar slimming pass; there is no workspace-wide
search today. This phase adds a **command-palette-style overlay** (think `⌘K`) for searching
across schemas, tables, columns, saved snippets, and query history — the navigation glue that ties
the now-larger feature set together. It builds on metadata (Phases 1/7), snippets (**Phase 13**),
and searchable history (**Phase 19**, which lands first so history is searchable here).

Backlog item: "Global search" in [`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **Client-side fuzzy search over already-loaded data first (principle §7).** Schemas/tables/
   columns come from the metadata the app already caches; snippets and history come from their
   existing endpoints. v1 does **not** add a new search backend — it indexes what's in memory and
   pages history search through the Phase 19 endpoint. A server-backed unified search is a later
   enhancement (Out of scope).
2. **It's navigation + actions, not execution (principles §4, §8).** Selecting a table opens its
   rows/structure tab; selecting a column reveals it in structure; selecting a snippet/history
   entry loads it into the active query tab (`workspaceStore.loadQuery`) — **never auto-runs**
   (consistent with Phases 10/13/19). Search results are typed and grouped by source.
3. **A command-palette overlay, not a TopBar input.** A keyboard-summoned (`⌘K`/`Ctrl K`) modal
   overlay with fuzzy matching, keyboard navigation, and grouped results — the home the backlog
   note calls for, rather than re-adding a TopBar field. Mobile gets an equivalent full-screen
   search sheet (principle §9).
4. **Results are bounded and ranked (principle §7).** Cap results per group; rank by match quality;
   debounce input. History search stays paged through the Phase 19 server endpoint; metadata/
   snippet search is in-memory over the loaded set.
5. **No new persistent state.** The palette is ephemeral UI; recent-search memory (if any) is
   client-only `localStorage`, not the app DB.

## Backend (`apps/api`)

None required for v1 — reuses metadata, snippet (Phase 13), and history-search (Phase 19)
endpoints. (A future unified `/search` endpoint is Out of scope.)

## Frontend (`apps/web`)

### Search index + palette
- A small client-side fuzzy matcher (e.g. a tiny matcher or `fuse.js`) over: cached metadata
  (schema/table/column names + types), `useSnippets` results, and `useHistorySearch` (server-paged)
  for history.
- A `CommandPalette` overlay: global `⌘K`/`Ctrl K` shortcut, debounced input, grouped + ranked
  results (Tables, Columns, Snippets, History), keyboard up/down/enter navigation, escape to close.
- Actions on select: open table rows/structure tab; reveal column in `TableStructurePanel`; load
  snippet/history into the active query tab (Phase 15). Token-styled (principle §9).
- Mobile: a full-screen search sheet invoked from the bottom nav / top bar.

### Tests (Vitest, `apps/web` — per Phase 12)
- Typing filters grouped results from mock metadata/snippets/history; selecting a table dispatches
  the open-tab action; selecting a snippet/history entry calls `loadQuery` (no auto-run); keyboard
  navigation + escape behave; results are capped per group.

## Verification

### Manual (demo target DB, port 5434)
1. `⌘K` → palette opens; type "ord" → `orders` table + matching columns + matching snippets/history
   grouped.
2. Select the table → its rows tab opens; select a column → structure panel reveals it.
3. Select a snippet / history entry → loads into the active query tab, does not run.
4. Search a history term → server-paged history matches appear.
5. Mobile: the search sheet works at ~360px and offers the same actions.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- A server-backed unified search endpoint / index across all data (v1 is client-side + reuse).
- Searching row **data** in target tables (would breach the §7 "never load everything" / §1 spirit
  for an internal tool; revisit deliberately).
- Command-palette actions beyond navigation + load (e.g. running commands, DDL) — navigation only.
- Cross-connection metadata search when a connection's metadata isn't loaded.
