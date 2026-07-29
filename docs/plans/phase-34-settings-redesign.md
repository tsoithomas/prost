# Prost — Phase 34: Settings & Preferences Redesign

## Context

Every user preference Prost supports — `colorMode`, `fontSize`, `gridDensity`, accent presets + custom
hex, custom palettes (`PALETTE_TOKEN_KEYS`), the per-connection accent override, and keybindings — is
today crammed into a single **~256px-wide dropdown** anchored to the TopBar gear
(`layout/SettingsPanel.tsx` → `layout/ThemeSettings.tsx` + `PaletteSettings` + `KeybindingSettings`), with
that same `ThemeSettings` block re-embedded in a divergent mobile surface
(`mobile/MobileSettingsView.tsx`, a full bottom-nav tab that also folds in connections/history/snippets).
The result is visually cramped, ungrouped, unsearchable, and split across places; the styling surface is
thin (only 5 of ~30 semantic tokens are user-overridable), and the write-through is duplicated across two
components with no rollback.

This phase replaces the dropdown with a **dedicated, well-organized Settings modal** — grouped sections, a
live preview, reset-to-defaults, search, and an **expanded set of fine-tune styling controls** — shared by
both shells. It rides the **existing** `themeStore` → `PreferenceModule` (`PATCH /preferences`)
write-through rather than adding a persistence path, and along the way extracts the shared `Modal`/`Tabs`
primitives the app currently hand-rolls in ~10 places. It is a strengthening phase in the theming lineage
of Phases 5 and 21, and depends on nothing.

Roadmap item: Phase 34 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md).

## Decisions (to confirm before building)

1. **One real Settings modal, not a cramped dropdown, and not two divergent forms (principles §9, §10).**
   A responsive `SettingsModal` — a centered dialog on desktop, a full-screen sheet on mobile (via
   `useIsMobile`) — with a left-rail (desktop) / segmented (mobile) **section nav**: *Appearance*,
   *Editor & Grid*, *Keyboard*, *Connections*, *Account*. The old `SettingsPanel` dropdown slims to a
   quick menu (a color-mode toggle + "All settings…" + View audit log + Sign out); `MobileSettingsView`'s
   Appearance section opens the **same** modal. One settings surface for both shells, ending the split
   where audit / sign-out / connections / sessions / history / snippets live in different places per
   platform.
2. **Extract the shared modal scaffolding — an internal-health refactor, not new product surface
   (principle §10, §13's "internal health" carve-out).** There is no `Modal`/`Tabs`/`Select` primitive in
   `@prost/ui` today; `ConfirmDialog` is the only dialog, and ~10 modals (`ConnectionModal`, the
   `ddl/*Modal`s, `LlmEndpointsModal`, `ImportModal`, `ExportDialog`, `SchemaExportDialog`, …) hand-roll
   the same `fixed inset-0 z-50 … bg-black/50` + `Surface` overlay. Extract a reusable **`Modal`**
   (focus-trapped, `Esc`-closing, centered-on-desktop / bottom-sheet-on-mobile, mirroring `ConfirmDialog`)
   plus a **`Tabs`/section-nav** primitive into `packages/ui`, and promote the app-local `SegmentedGroup`
   (currently inlined and private in `ThemeSettings`), `ColorField`, and `FormField` into `@prost/ui`. The
   settings modal composes these; the other hand-rolled modals may adopt `Modal` opportunistically (out of
   scope to migrate them all here).
3. **Expanded fine-tune styling, all token-driven and allowlisted (principles §2, §9).** Add controls for
   **font family** (a separate UI font and monospace/editor font, each from a **curated safe list** — no
   arbitrary CSS or font-file uploads, mirroring how `PALETTE_TOKEN_KEYS` allowlists palette overrides),
   **UI scale / border-radius** (a `radiusScale`), a **grid-density live preview**, and **data-cell type
   colors** (the six `--color-data-*` tints plus status colors — extending the palette token-key idiom to
   a wider allowlist). Also **surface `columnRenderOverrides`** as a read/reset list (today they are
   editable only via the in-grid right-click `ColumnRenderMenu` and appear nowhere in Settings). Each new
   option maps to a **semantic token** applied via a new `apply*` in `packages/ui/src/theme/applyTheme.ts`
   (alongside `applyFontSize`/`applyGridDensity`) with the token registered in
   `packages/ui/src/theme/tokens.css` — **no hardcoded hex in components**.
4. **New options are optional fields on `UserPreferenceDto`, one contract, no new route (principle §6).**
   Widen `UserPreferenceDto` in `@prost/shared-types` with optional fields (e.g. `fontFamily?`,
   `monoFontFamily?`, `radiusScale?`, `uiScale?`, `dataColors?`) plus the matching allowlist
   constants/validators, and add the columns to the Prisma `UserPreference` model (SQLite: string/JSON
   defaults, as the existing fields do). `PreferenceService`'s existing partial-merge `PATCH`
   (`preference-validation.ts`) absorbs them, validating against the allowlists server-side (§11). No new
   endpoint. The modal keeps the **optimistic write-through** but **centralizes** it — the `save()` helper
   duplicated in `ThemeSettings`/`PaletteSettings` becomes one hook so every control writes through
   identically.
5. **Live preview, reset, search, and portable settings (usability, principle §8).** Each section shows a
   small live-preview (a sample grid row, a code line, a button) reflecting the current (already-applied)
   choices; a **Reset to defaults** action per-section and globally; a **search box** filters the visible
   controls by label; and **export / import settings** serializes the `UserPreferenceDto` to/from a JSON
   file (reusing the Phase 30 JSON formatter). The export contains **app-DB preferences only — never
   secrets or target data** (§1, §3).
6. **Accessible by construction (pairs with Phase 35).** The modal traps focus, is fully keyboard-navigable
   (arrow/tab between sections, `Esc` to close, `role="dialog"`/`aria-modal` like `ConfirmDialog`), and
   every control is labeled — it becomes the reference implementation the Phase 35 a11y pass generalizes.

## Backend (`apps/api`)

### `PreferenceModule` (extend, no new route)
- Widen `UserPreferenceDto` + `UpdatePreferenceDto` in `@prost/shared-types` with the new optional styling
  fields and their allowlist constants (`FONT_FAMILIES`, `RADIUS_SCALES`, `DATA_COLOR_KEYS`, …), mirroring
  `FONT_SIZES`/`PALETTE_TOKEN_KEYS`.
- Add the columns to `model UserPreference` in `apps/api/prisma/schema.prisma` (string/JSON with defaults,
  as the existing structured fields); write the Prisma migration.
- Extend `preference-validation.ts` with pure validators for the new fields (reject values outside the
  allowlists / not matching `HEX_COLOR_PATTERN` → `BadRequestException`, §11); `PreferenceService.update`'s
  `upsert`/PATCH semantics and `toUserPreferenceDto`/`toRowData` absorb the fields unchanged in shape.

### Tests (Vitest, `apps/api`)
- New fields round-trip through `GET`/`PATCH /preferences`; partial PATCH leaves unrelated fields intact;
  a value outside an allowlist / an invalid hex → `400` before any write; defaults returned when unset.

## Frontend (`apps/web` + `packages/ui`)

### New shared primitives (`packages/ui`)
- `Modal` (focus-trap + `Esc` + overlay, centered/bottom-sheet responsive — factor from `ConfirmDialog`'s
  overlay), `Tabs`/section-nav, and promoted `SegmentedGroup` / `ColorField` / `FormField`. New `apply*`
  helpers in `applyTheme.ts` (`applyFontFamily`, `applyRadiusScale`, `applyUiScale`, `applyDataColors`) +
  token registrations in `tokens.css`; `themeStore` gains the corresponding state + setters and persists
  them (its `partialize`/`onRehydrateStorage` already re-applies theme on load).

### `SettingsModal` (`apps/web/src/layout`)
- A `SettingsModal` composing the primitives, with one section component per nav item (refactor
  `ThemeSettings`/`PaletteSettings`/`KeybindingSettings` into `AppearanceSection` / `EditorGridSection` /
  `KeyboardSection`, plus `ConnectionsSection` and `AccountSection`). A shared `useSavePreference` hook
  centralizes the optimistic `themeStore` set + `useUpdatePreferences().mutate`. Live-preview, per-section
  reset, search filter, and JSON export/import controls. `SettingsPanel` becomes the slim quick-menu
  launcher (opens the modal); `MobileSettingsView`'s Appearance opens the same modal.

### Tests (Vitest, `apps/web` — per Phase 12)
- Modal opens from both shells and switches sections; a new styling option (e.g. font family / radius /
  data color) persists via `PATCH` **and** applies (asserted through the token on `<html>`); reset restores
  defaults; search filters controls; export→import round-trips a `UserPreferenceDto`; `columnRenderOverrides`
  render as a resettable list; mobile renders full-screen; focus is trapped and `Esc` closes.

## Verification

### Manual (any connection)
1. Open Settings → the modal shows grouped sections; change **font family**, **border-radius**, and a
   **data-cell color** → the UI updates live; reload → the change persists (server wins over localStorage).
2. **Reset to defaults** (section + global) restores the shipped look; **search** filters controls by label.
3. **Export settings** to JSON, change a few options, **import** the file back → the prior state is restored;
   confirm the file contains no secrets/target data.
4. Mobile: the Settings tab's Appearance opens the same full-screen modal; touch targets ≥44px; `Esc`/back
   closes; focus is trapped while open.
5. The slimmed TopBar dropdown still reaches View audit log / Sign out; the old controls now live in the modal.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Theme marketplace / sharing themes (single-user — §13); arbitrary user CSS or font-file uploads (curated
  allowlists only).
- Per-workspace theming beyond the per-connection overrides Phase 21 already ships.
- Migrating **all** hand-rolled modals to the new `Modal` primitive (this phase extracts it and adopts it
  in Settings; broad migration is a separate cleanup).
- Editing `columnRenderOverrides` from Settings (surfaced read/reset only; authoring stays in the grid menu).
