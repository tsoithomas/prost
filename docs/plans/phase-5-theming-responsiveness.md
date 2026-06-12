# Prost — Phase 5: Theming & Responsiveness Hardening

## Context

Theming and responsiveness are **structural, not bolted on** (principle §9), so they appear in
every phase as features land. Phase 0 already shipped the full token system, light/dark/system
mode, accent selection, the no-flash pre-hydration script, and the desktop/mobile shell split.
What's missing is **server-side persistence of preferences** and a disciplined **audit pass**
once all features (editing, SQL editor, history) exist — verifying each new surface honors the
tokens and the mobile navigation model at every breakpoint.

This phase is therefore two things: (1) a small backend feature — `PreferenceModule` — that
persists `colorMode`/`accentColor` to `UserPreference` and round-trips them through the
existing `themeStore`; and (2) a cross-cutting verification sweep (spec §8, §11 steps 8–9).

The pieces already in place: `UserPreference` Prisma model (`apps/api/prisma/schema.prisma`),
`UserPreferenceDto` (`packages/shared-types/src/user.ts`), `themeStore`
(`apps/web/src/stores/themeStore.ts`, the runtime source of truth, persisted to
`localStorage`), token system (`packages/ui/src/theme/tokens.css`), and grid/Monaco theming
(`gridTheme.ts`, `monacoTheme.ts`).

## Decisions (to confirm before building)

1. **New `PreferenceModule`** (spec §6, principle §10), app-DB only via Prisma. Persists
   `{ colorMode, accentColor }` per user to `UserPreference`.
2. **`localStorage` stays the instant-first-paint source; the server is the durable mirror**
   (spec §8.4, principle §9). On login, fetch server preferences and hydrate `themeStore`; on
   change, write through to the server (debounced) while `themeStore` remains the runtime
   source of truth. The pre-hydration inline script in `index.html` is unchanged — no flash.
3. **No new theming mechanism.** Components already consume semantic tokens; the audit
   **enforces** that — it does not introduce a parallel system. Any hardcoded hex found is a
   defect to fix (principle §9), not a reason to add tooling.
4. **Mobile navigation model is fixed** (spec §8.5): bottom navbar replaces the side drawer;
   burger opens a bottom sheet. The audit confirms every Phase 2–4 surface (edit dialogs,
   Monaco, history panel, confirmation dialogs) honors it rather than inventing its own nav.
5. **Breakpoints audited: 360 / 768 / 1280px** (spec §8.5, §11 step 9).

## Backend (`apps/api`)

### `PreferenceModule` (new — `apps/api/src/preference/`)

- `preference.service.ts` (Prisma only): `get(userId)` (upsert-default if absent → returns the
  schema defaults `system` / `#498fff`), `update(userId, dto)` (upsert).
- `preference.controller.ts`: `GET /preferences` and `PATCH /preferences`, JWT-guarded,
  `@CurrentUser()`-scoped, `UserPreferenceDto` in/out, validated with class-validator
  (`colorMode` ∈ `light|dark|system`, `accentColor` a valid hex/token).
- App-DB only — no `pg` driver here (principle §1).

## Frontend (`apps/web`)

### Persistence wiring

- `usedPreferences` TanStack hooks (`src/api/preferences.ts`): `usePreferences` (GET, enabled
  when authed) and `useUpdatePreferences` (PATCH).
- On successful login / `useMe`, hydrate `themeStore` from server preferences (server value
  wins over `localStorage` once authenticated, reconciling cross-device). The Settings panel's
  mode + accent controls write through `useUpdatePreferences` (debounced) so a reload — or a
  different device — restores the choice (spec §8.4).
- Keep `themeStore` the runtime source of truth; the pre-hydration script and `localStorage`
  mirror are untouched (no-flash guarantee preserved).

### Responsiveness / theming audit (the sweep)

Walk every surface added in Phases 1–4 and verify against principle §9 + spec §8:

- **Token discipline:** grep components for hardcoded hex / non-token colors; replace with
  semantic tokens. Confirm AG Grid (`gridTheme.ts`) and Monaco (`monacoTheme.ts`) re-theme on
  mode/accent change — Monaco must re-run its `getComputedStyle` snapshot after a theme change.
- **Editing surfaces (Phase 2):** inline-edit affordances, insert row, **delete confirmation
  dialog**, and **error toasts** are token-themed and become full-screen sheets / reachable
  targets on mobile (≥44px hit areas).
- **SQL editor (Phase 3):** Monaco full-width + height-capped on mobile, results grid stacked
  below, run reachable from the bottom navbar.
- **History (Phase 4):** recent-queries panel works in the desktop Sidebar tab **and** the
  mobile bottom sheet.
- **Grid on small screens:** horizontal scroll with sticky header / first column; pagination
  controls stay above the bottom navbar (safe-area-inset aware).
- **Mobile nav integrity:** exactly one navigation model — bottom navbar + bottom sheet; no
  stray top-bar burger or side drawer leaking in on mobile (spec §8.5).

## Verification

### Unit (Vitest, `apps/api`)
- `PreferenceService.get` returns defaults when no row exists; `update` upserts; both scoped to
  the user. `colorMode`/`accentColor` validation rejects bad values.

### End-to-end (manual — spec §11 steps 8–9)
1. **Theming round-trip:** toggle light/dark/system and change accent in Settings → whole UI
   (incl. grid + Monaco) updates live; reload preserves the choice **with no flash**; confirm
   the preference persisted server-side (`UserPreference` row updated) and restores on a
   different browser/device after login.
2. **Responsive sweep at 360 / 768 / 1280px:**
   - Mobile: fixed bottom navbar (essential buttons + burger) **replaces** the side drawer; the
     burger opens a bottom-sheet menu sliding up from the bottom (schema tree, connection
     switcher, settings/theme, query history, sign out); dismiss via swipe-down / scrim.
   - Grid scrolls horizontally with sticky header; modals/dialogs become full-screen sheets;
     all controls stay reachable above the navbar.
   - Desktop keeps the side-by-side sidebar layout with **no** bottom navbar.
3. **Token audit clean:** no hardcoded colors remain in components; mode + accent switch every
   surface including the Phase 2–4 additions.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## MVP completion

When Phase 5 verification passes, the §12 MVP completion criteria of `prost-mvp.md` are met:
login → connect → browse → view → edit/insert/delete → run SQL → view/edit results → history,
with theming and the responsive mobile experience verified. At that point Prost is a usable
internal PostgreSQL client MVP.

## Out of scope (post-MVP)

- Additional preference types beyond `colorMode`/`accentColor` (font size, grid density,
  keybindings).
- Per-connection or per-workspace theme overrides.
- Custom user-uploaded themes / palettes beyond the preset + custom-hex accent.
- Automated visual-regression / cross-browser testing infrastructure (the audit is manual for
  MVP, per principle §13).
