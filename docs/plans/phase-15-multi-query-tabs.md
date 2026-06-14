# Prost — Phase 15: Multi-Query Tabs

## Context

Today `SqlEditorView` keeps its SQL buffer, result set, and run state in **component-local
`useState`**. The `WorkspaceTabBar` exists but the sole query tab's close button is hidden as a
guard against the unrecoverable-empty-state trap, and there is no "+ New Query". A `+` affordance
is meaningless until per-tab state moves into `workspaceStore` — otherwise multiple tabs would all
render the *same* editor instance and clobber each other.

This phase is primarily a **state refactor** (lift per-tab editor state into `workspaceStore`)
that then *enables* multi-query tabs. It is the prerequisite for Phase 16 (a transaction/script
runs in a tab) and Phase 17 (per-tab schema-aware completion). It depends on **Phase 12** so the
refactor ships with regression tests.

Backlog item: "Multi-query tabs ('+ New Query')" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **`workspaceStore` owns an array of query tabs**, each with its own id, title, Monaco buffer,
   result set, run state, and editability flag — `SqlEditorView` becomes a pure renderer of the
   active tab (principle §4: the store decides, the component renders). No editor state lives in
   component `useState` anymore.
2. **One unrecoverable-empty-state guard, preserved.** The close button is enabled only when >1
   tab exists; closing the last tab is impossible (or replaces it with a fresh empty tab) — the
   exact guard the current hidden-close-button protects, kept intact.
3. **Tabs are session state, not persisted server-side in v1.** Open tabs live in the store
   (optionally `persist`ed to `localStorage` like `themeStore`), not in the app DB. Persisting
   transcripts/sessions server-side stays out of scope (consistent with Phase 10). Closing a tab
   discards its unsaved buffer — covered by the snippets feature (Phase 13) for anything worth
   keeping.
4. **Existing entry points target the active tab.** History click-to-load, snippet load, and AI
   "Load into editor" (`workspaceStore.loadQuery`) all populate the **active** tab — or open a new
   tab if the active one is dirty (pick one behaviour; "replace active, it's a load action" is the
   simpler default). The `loadQuery` contract stays stable for callers.
5. **Each tab runs independently.** Running tab A doesn't block editing tab B; each tab tracks its
   own in-flight/result/error state. Results still page via the Infinite Row Model per tab
   (principle §7).

## Backend (`apps/api`)

None — this is a frontend state refactor. The query/execution endpoints are unchanged (still one
statement per run until Phase 16). No new shared types unless a tab descriptor is shared (it
isn't — tabs are client-only).

## Frontend (`apps/web`)

### `workspaceStore`
- Model `tabs: QueryTab[]` + `activeTabId`; actions: `newTab`, `closeTab`, `setActiveTab`,
  `renameTab`, `setTabSql`, `setTabResult`, `loadQuery` (now targets the active tab). Keep
  `loadQuery`'s external signature so History/Snippets/AI callers don't change.
- Optionally `persist` tabs to `localStorage` (mirroring `themeStore`'s pattern).

### `SqlEditorView` + `WorkspaceTabBar`
- `SqlEditorView` reads/writes only the active tab via the store; mount a Monaco model per tab (or
  swap models on tab switch) so buffers don't bleed.
- `WorkspaceTabBar`: enable "+ New Query"; show per-tab title (default "Query N", editable);
  enable close when >1 tab; active-tab highlight. Mobile: a compact tab strip / switcher consistent
  with the mobile shell (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- New tab adds an independent buffer; switching tabs preserves each buffer/result; running one tab
  doesn't mutate another; closing the last tab is prevented (or recreates an empty tab);
  `loadQuery` populates the active tab without auto-running.

## Verification

### Manual
1. Open the SQL editor → one tab. Click "+ New Query" → a second, independent tab.
2. Type different SQL in each, run each → each shows its own results; switching tabs preserves
   buffer + results.
3. Load a History entry / snippet / AI suggestion → lands in the active tab, doesn't auto-run.
4. Close a tab → gone; closing down to the last tab is prevented (or leaves a fresh empty tab).
5. Reload the app → (if persisted) tabs restore; otherwise a single fresh tab. No state bleed.
6. Works at ~360px.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Server-side persistence of open tabs/sessions across devices.
- Split-pane / side-by-side tab views; drag-to-reorder tabs (nice-to-have, not v1).
- Per-tab connection targeting (all tabs use the active connection in v1).
- Multi-statement execution within a tab — **Phase 16**.
