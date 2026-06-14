# Prost — Phase 21: Preferences & Theming Expansion

## Context

`PreferenceModule` persists per-user `colorMode`/`accentColor` (server wins over `localStorage`,
hydrating `themeStore` once per session); `ThemeSettings` offers accent presets + a custom hex.
This phase broadens both: **more preference types** (font size, grid density, keybindings),
**per-connection / per-workspace theme overrides**, and **custom user-uploaded palettes** beyond
the preset + single-hex picker. It only extends the existing `PreferenceModule` and the
`themeStore`/`applyTheme` machinery (principle §9 — theming is structural) and is independent of
every other phase.

Backlog items (under "Theming / preferences" in [`../future-features.md`](../future-features.md)):
additional preference types; per-connection/per-workspace overrides; custom uploaded themes.

## Decisions (to confirm before building)

1. **Preferences remain a single per-user app-DB record, extended (principles §1, §6).** Grow
   `UserPreferenceDto` + the Prisma `UserPreference` model with `fontSize`, `gridDensity`, and a
   `keybindings` map; per-connection overrides live in a small related shape (keyed by
   connectionId) rather than a forked model. One contract in `@prost/shared-types`, both sides
   import it. Server stays the source of truth, `localStorage` the pre-paint cache (the existing
   precedence rule, principle §9).
2. **New tokens flow through the existing single source (principle §9).** Font size and grid
   density resolve to the **existing token system** — `tokens.css` / `applyTheme.ts` for font
   scale, the AG Grid `themeQuartz.withParams` density params for the grid. **No hardcoded values
   in components** — add scale tokens, don't sprinkle pixel literals.
3. **Per-connection theme override = a scoped accent/mode applied on connection switch.** When a
   connection has an override, `applyTheme` uses it while that connection is active and reverts to
   the global preference otherwise (a guardrail many clients use to make "prod" visually obvious).
   This is presentation state keyed off the active connection; it never touches target data.
4. **Custom palettes are validated, bounded data (principles §8, §11).** A user-defined palette is
   a small set of named color values, validated server-side (must be parseable colors, capped
   count) before persistence; an invalid upload returns a specific `400`, never a half-applied
   theme. Applied through the same inline-`<html>`-style accent path, extended to the custom
   palette's keys.
5. **Keybindings are remappable but safe-defaulted.** A preferences map overriding default editor/
   app shortcuts (Run, Format from Phase 17, command palette from Phase 20); conflicts are detected
   and surfaced (principle §11); a reset-to-defaults escape hatch always exists so a user can't lock
   themselves out.

## Backend (`apps/api`)

### Prisma + `PreferenceModule`
- Extend `UserPreference` with `fontSize`, `gridDensity`, `keybindings` (JSON), and a per-
  connection override map (JSON keyed by connectionId, or a related table); migrate.
- `PreferenceService` validates on write: enum-bounded `fontSize`/`gridDensity`, color-validated
  + count-capped custom palettes, keybinding shape; specific `400` on invalid (principle §11).
- `GET`/`PATCH /preferences` extended to carry the new fields (still one per-user record).

### Tests (Vitest, `apps/api`)
- New fields round-trip; invalid palette/keybinding/density → 400; per-connection override stored
  and returned; defaults applied when absent.

## Frontend (`apps/web` + `packages/ui`)

### Tokens + theming
- Add font-scale tokens to `tokens.css` and a grid-density mapping in
  `packages/ui/src/grid/gridTheme.ts`; `applyTheme.ts` extended to apply font scale, custom-palette
  keys, and a per-connection override when one is active (revert on switch). Mind the Tailwind
  `@source` content-scanning note for any new UI classes inside `packages/ui`.

### `SettingsPanel` / `ThemeSettings`
- New controls: font-size selector, grid-density selector, a custom-palette editor (add/validate/
  name colors), a per-connection override toggle (set the active connection's theme), and a
  keybindings editor with conflict warnings + reset-to-defaults. Wire through the extended
  preference hooks; write-through on change (the existing pattern). Mobile Settings parity
  (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- Changing font size/density updates the resolved tokens/grid params; a per-connection override
  applies on switch and reverts; an invalid custom palette surfaces the error; a keybinding
  conflict warns; reset-to-defaults restores; server preference still wins over `localStorage` on
  hydration.

## Verification

### Manual
1. Change font size + grid density → editor/grid reflect it immediately and after reload (server
   persisted, no flash).
2. Define a custom palette → accent/colors apply through the token path; an invalid color is
   rejected with a clear message.
3. Set a per-connection theme override → switching to that connection changes the theme; switching
   away reverts to global.
4. Remap "Run" / open-palette keybindings → new keys work; a conflict warns; reset restores
   defaults.
5. Clear `localStorage`, reload → server preferences hydrate correctly (precedence intact).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Importing third-party theme files / a theme marketplace.
- Full per-workspace (multi-tab layout) persistence beyond per-connection theme (workspace
  persistence ties to the Phase 15 Out-of-scope item).
- Localization / i18n of the UI.
- OS-level / per-device preference sync beyond the per-user server record.
