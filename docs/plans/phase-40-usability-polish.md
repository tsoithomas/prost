# Prost — Phase 40: Usability & Interaction Polish

## Context

Phase 35 hardened *accessibility* (focus management, ARIA, a token focus ring, a keyboard-shortcut
registry + help overlay, `axe-core`), but it explicitly scoped out product-feel polish, and left a
named gap unaddressed: its Decision 3 called for a "focus results" action that never reached
`KEYBINDING_ACTIONS`, which still holds only 7 chords. Since then the app has accumulated a set of
interaction-quality gaps that no phase owns:

- `Ctrl/Cmd+F` does nothing, even though the grid's cross-column search box (`TableView`) already
  exists — there's just no shortcut to it.
- There is no way to copy a cell or row's value.
- The `TableView` refresh button gives **zero** visual feedback while `SessionsPanel`/`AuditPanel`
  already spin the identical `RefreshCw` icon off `isFetching`.
- Roughly a third of icon-only buttons carry no tooltip at all, and `packages/ui` has no `Tooltip`
  primitive — only native `title=`, which never fires on keyboard focus, has OS-controlled timing,
  and can't render a chord.
- The command palette (`CommandPalette`) can search tables/columns/snippets/history but cannot
  *run* anything — there is no discoverable list of app actions.
- There is no way to reclaim screen space for the grid short of manually collapsing three chrome
  regions (sidebar, AI panel, and living with the fixed top/status bars).
- The grid's cell context menu only appears on FK columns (`TableView.tsx`'s
  `buildCellMenuItems`), so most cells have no right-click affordance at all.

This is a **strengthening** phase — it adds no new data capability, so it needs no §13 amendment
(the same "internal health" carve-out Phase 34's settings redesign used). It depends on Phases 34
(the shared `Modal`) and 35 (the keybinding registry, `resolveBinding`/`formatChord`, and the
accessibility patterns it generalizes).

Roadmap item: Phase 40 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md). Depends on 34, 35.

## Decisions (to confirm before building)

1. **A real `Tooltip` primitive in `packages/ui`, not more `title=` (principle §9).** Native
   `title` is invisible to keyboard focus and can't render a chord. `Tooltip` shows on hover *and*
   focus, is token-styled, honors `reduceMotion`, and is suppressed on touch — a hover affordance is
   dead weight where long-press already means something (the grid's FK menu).
2. **Every new animation is already gated for free (principle §9).** `tokens.css`'s
   `[data-reduce-motion] *` rule zeroes transition/animation durations app-wide. New feedback
   (spinners, flashes, skeletons) must use CSS transitions/animations, never JS-driven timing, so
   this coverage is automatic and no new preference plumbing is needed.
3. **One keyboard-shortcut registry stays the single source (principle §6, continuing Phase 35's
   Decision 3).** New actions are added to `KEYBINDING_ACTIONS` in `@prost/shared-types`, never
   hardcoded per component; `ShortcutsHelp` and the Settings remap editor pick them up
   automatically. A bare **`?`** stays a fixed alias for `show-shortcuts` (not a registry entry,
   since `chordFromEvent` rejects modifier-less chords by design).
4. **The ER diagram's plain-wheel zoom is correct as shipped — not a bug to fix.** The canvas is
   `overflow-hidden` (no scroll to preserve), panning is already covered by drag and two-finger
   pinch, and a trackpad pinch already arrives as `ctrlKey`+wheel and zooms through the same path.
   This phase does not gate zoom behind `Ctrl`; it only adds tooltips to the diagram's toolbar.
5. **Both shells, per principle §9.** Focus mode, new shortcuts, and tooltips need a desktop
   (`apps/web/src/layout/`) and mobile (`apps/web/src/mobile/`) treatment — not a
   desktop-only feature that mobile silently lacks.
6. **Frontend-only.** No new API routes, no driver work. The only backend-adjacent touch is the
   `keybindings` preference already persisted by `PreferenceModule` (`KeybindingMap` is a plain
   `Record<string, string>`, so new action ids need no schema change) and widening
   `CHORD_PATTERN` if a new default chord needs it.
7. **Command-palette actions are navigation/UI only (principles §4, §8).** The palette gains a
   `commands` section, but no command executes SQL or mutates data — that would contradict the
   palette's existing "never auto-runs a query" posture.

## Backend (`apps/api`)

None. The `keybindings`/`reduceMotion` preference fields already exist
(`apps/api/src/preference/`); this phase adds no new preference keys, routes, or DTOs.

## Frontend (`apps/web` + `packages/ui`)

### A. Keyboard shortcuts
- Extend `KEYBINDING_ACTIONS` (`packages/shared-types/src/user.ts`) with: `find-in-grid` (`mod+f`),
  `copy-cells` (`mod+c`), `next-tab`/`prev-tab` (`alt+pagedown`/`alt+pageup`),
  `focus-editor`/`focus-results` (`alt+1`/`alt+2`), `toggle-left-sidebar`/`toggle-ai-sidebar`
  (`alt+b`/`alt+j`), `toggle-focus-mode` (`alt+enter`), `refresh-view` (`alt+r`), `save-edits`
  (`mod+s`).
- Extend `chordFromEvent` (`apps/web/src/keybindings/index.ts`) to admit `PageUp`/`PageDown` (today
  it drops any key name longer than one character except `enter`), so the Settings chord recorder
  can capture the new defaults.
- Wire the new **global** actions (sidebar toggles, focus mode, tab next/prev/focus) into
  `AppLayout.tsx`'s existing `bindings` dispatch array; guard chords that would shadow native
  browser/input behaviour (`mod+c`, `mod+f`) by checking `document.activeElement` first.
- Wire the new **grid-scoped** actions into `TableView.tsx`'s existing `onGridKeyDown`: `mod+f`
  focuses the search input (`searchInputRef`, already present); `mod+c` copies the focused cell or
  selected rows as TSV to `navigator.clipboard` (AG Grid Community has no clipboard module); `mod+s`
  triggers `handleSave()` when `editBuffer.dirtyCells > 0`; `alt+r` triggers the same refresh path
  as the toolbar button.
- Add `Escape`-to-close to `FilterPanel` and `JsonCellPopup` (matching the existing behaviour of
  `ColumnRenderMenu`/`CellContextMenu`).

### B. Tooltips & discoverability
- New `packages/ui/src/components/Tooltip.tsx` (exported from `components/index.ts`): shows on
  `mouseenter`/focus, hides on `mouseleave`/`blur`/`Escape`, ~400ms open delay, token-styled,
  viewport-aware positioning, `role="tooltip"` + `aria-describedby`; suppressed on touch; accepts an
  optional `shortcut?: string` rendering a trailing `<kbd>` (callers pass
  `formatChord(resolveBinding(actionId, keybindings))`).
- Adopt `Tooltip` on previously untooltipped icon-only controls: the row-insert group in
  `TableView.tsx` (Add row, Delete selected rows, Save new row, Cancel new row), the ER diagram's
  zoom/fit buttons (`ErDiagramView.tsx`), and `TopBar`'s Settings button. `IconButton`'s required
  `aria-label` is unchanged — the tooltip is additive.
- Add a `commands` section (listed first, shown even on an empty query) to `CommandPalette.tsx`,
  backed by a new `apps/web/src/search/commands.ts` registry (id, label, `run`, optional
  `keybindingId`, `enabled` predicate) seeded with: new query tab, close tab, toggle focus mode,
  toggle left/AI sidebar, open settings, show shortcuts, refresh current view, export current
  table, open ER diagram, toggle theme. Extend `searchIndex.ts`'s `SearchItem`/`GroupedResults`
  union with a `command` variant so `flattenResults` keeps arrow-key navigation working unchanged;
  each row shows its chord via `formatChord`.

### C. Feedback & animation
- Add a `loading?: boolean` prop to `Button` (`packages/ui/src/components/Button.tsx`): renders a
  spinning `Loader2` in place of leading content, sets `disabled` + `aria-busy`.
- `TableView`'s refresh button: track a local `refreshing` state set on click and cleared in the
  datasource's `successCallback`/`failCallback`, spin `RefreshCw` with `animate-spin` while set
  (mirroring `SessionsPanel`/`AuditPanel`'s existing `isFetching`-driven spin), with a ~400ms
  minimum visible duration so an instant refresh still registers.
- Add success toasts (via the existing `useToasts`) for saved edits, inserted rows, deleted rows,
  and copy-to-clipboard — today `TableView` only toasts on error.
- Flash the affected row(s) briefly after a successful save/insert (AG Grid's `flashCells`).
- Replace the "Loading table…" text state with shimmer skeleton rows; add a small `Skeleton` to
  `packages/ui` with shimmer keyframes in `tokens.css` beside the existing reduce-motion block.
- Show a live elapsed-time counter next to the Run button in `SqlEditorView` while a query executes.

### D. Focus mode & layout
- Add persisted `leftSidebarCollapsed` and `focusMode` state (plus toggles) to
  `apps/web/src/stores/layoutStore.ts`; move `Sidebar`'s local `collapsed` `useState` into this
  store so it survives reload and can be driven by focus mode.
- `AppLayout.tsx`: when `focusMode` is on, render only `<main>` — skip `TopBar`, `Sidebar`,
  `RightSidebar`, `StatusBar` — with a single floating restore `IconButton` (tooltip + chord).
  `Escape` exits. `MobileShell` gets the equivalent treatment (hide its top bar + bottom nav, keep
  a floating restore).
- Add maximize-editor/maximize-results toggles plus a draggable splitter to `SqlEditorView`'s
  editor/results split (today a hardcoded `max-md:h-2/5`/`h-3/5`). Generalize
  `apps/web/src/hooks/useResizableWidth.ts` to a `useResizablePane` that also handles the vertical
  axis, rather than duplicating the drag math.

### E. Grid & ER-diagram ergonomics
- `TableView.tsx`'s cell context menu currently returns nothing for a cell with no FK target
  (`buildCellMenuItems`). Always build a menu, prepending generic actions — Copy value, Copy row
  (TSV), Copy row (JSON), Set NULL (when editable), Filter by this value (reusing the existing
  `handleFilterColumn`) — ahead of any FK entries. Widen `CellContextMenu`'s `CellMenuItem` shape
  (currently `direction: 'forward' | 'reverse'`) to admit a generic icon + an optional separator
  marker.
- Add `tooltipValueGetter` + `tooltipShowDelay` in `columnDefs.tsx`'s `buildColumnDefs` so a
  truncated cell value is readable on hover; a masked column's tooltip must show the token, never
  the underlying value (Phase 39).
- Add `enableCellTextSelection` to the grid; verify it doesn't fight the existing long-press handler
  on touch.
- Add an auto-size-columns toolbar action (`autoSizeAllColumns()`).
- `ErDiagramView`'s wheel handler is unchanged (see Decision 4) beyond the new tooltips on its
  toolbar buttons; add a code comment marking plain-wheel zoom as intentional.

### F. Small wins
- Middle-click a workspace tab to close it; double-click empty tab-bar space opens a new query tab
  (`WorkspaceTabBar.tsx`).
- Route closing a table tab with `editBuffer.dirtyCells > 0` through the existing `useConfirm`
  instead of discarding staged edits silently.
- Persist the last-used table view mode (rows/structure/profile) per table, alongside the existing
  per-connection pattern in `apps/web/src/stores/pinnedTablesStore.ts`.

### Tests (Vitest, `apps/web` — per Phase 12)
- `keybindings.test.ts`: the new chords parse and round-trip through `chordFromEvent`;
  `findKeybindingConflicts` reports no collisions across the now-larger default map.
- `AppLayout.test.tsx`: focus mode hides chrome and restores it; the toggle chord and `Escape` both
  work; both shells covered.
- `Tooltip.test.tsx`: opens on focus (not just hover), closes on `Escape`, sets
  `aria-describedby`, renders a passed chord, renders nothing on touch.
- `CommandPalette.test.tsx`: commands show on an empty query; arrow-key navigation spans commands
  and data results; selecting a command runs it and closes the palette.
- `TableView` tests: `mod+f` focuses the search box; `mod+c` writes TSV to a mocked
  `navigator.clipboard`; the refresh icon carries `animate-spin` while refreshing; the cell menu
  opens (with copy actions) on a non-FK cell.
- `ErDiagramView.test.tsx`: keep the existing plain-wheel-zoom assertion as a regression guard.
- Extend `test/a11y.axe.test.tsx` to cover the tooltip and the focus-mode shell.

## Verification

### Manual (demo target DBs)
1. Open `public.users`: `Ctrl+F` focuses search; `Ctrl+C` on a cell copies a value that pastes
   elsewhere; right-click a non-FK cell shows copy actions; the refresh icon visibly spins; hovering
   *and* tab-focusing a toolbar button shows a tooltip with its chord.
2. `Alt+Enter` enters focus mode — only the grid remains; the floating restore button and `Escape`
   both exit; reload preserves the sidebar's collapsed state.
3. `Cmd/Ctrl+K` with an empty query lists commands; running "Toggle focus mode" works.
4. Open the ER diagram for `public`: a plain wheel still zooms at the pointer, drag still pans, and
   the zoom/fit buttons now carry tooltips.
5. Settings › Appearance → enable Reduce motion; confirm the spinner/flash/skeleton animations stop.
6. Settings › Keyboard: remap one new action; confirm the chord takes effect and the shortcuts
   overlay (`?`) reflects it.
7. Mobile viewport (<768px): tooltips are suppressed, focus mode hides the bottom nav, long-press
   still opens the FK menu.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Any new data capability, API route, or driver work — this phase adds none.
- A headless-browser E2E/visual-regression harness (still the unscheduled candidate from Phase 35).
- Full WCAG-AA certification (Phase 35's boundary stands).
- Drag-to-reorder grid columns, column groups, or a saved per-table layout (persisted layouts stay
  frozen — §13).
- Command-palette commands that execute SQL or mutate data (navigation/UI only — §4, §8).
- Changing the ER diagram's zoom trigger (plain wheel is intentional, not a gap — see Decision 4).
