# Prost — Phase 35: Accessibility & Keyboard-Navigation Hardening

## Context

Prost is mobile-first and token-themed (Phases 5/21), but accessibility has never had a dedicated pass:
focus is not consistently trapped in the many hand-rolled modals, ARIA roles/labels on the grid / schema
tree / tab bar are ad-hoc, focus rings are inconsistent, and the keyboard-shortcut surface
(`KEYBINDING_ACTIONS`, Phase 21) is small and undocumented in-app. This phase is a **strengthening** slice
that audits and closes the gaps, generalizing the accessible-modal pattern established by Phase 34's
`SettingsModal`, and adds an automated `axe-core` check to the existing Vitest+RTL harness so regressions
are caught. It depends on nothing (and reads best after Phase 34, which lands the shared `Modal`).

Roadmap item: Phase 35 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md).

## Decisions (to confirm before building)

1. **Focus management is centralized in the shared `Modal` (principles §9, §10).** Every dialog traps
   focus, restores it to the trigger on close, closes on `Esc`, and carries `role="dialog"`/`aria-modal`
   (as `ConfirmDialog` already does). Modals still hand-rolling their overlay adopt the Phase-34 `Modal`
   so the behavior is one implementation, not N.
2. **ARIA/labels are structural, from tokens, no hex (principle §9).** The grid, schema tree
   (`SchemaTree`), workspace tab bar (`WorkspaceTabBar`), command palette (`CommandPalette`), and bottom
   nav get correct roles/labels/`aria-current`/`aria-expanded`, and a **visible focus ring** driven by a
   semantic token (works in light/dark/accent). Icon-only controls already require `aria-label`
   (`IconButton`); this audits the rest.
3. **One keyboard-shortcut registry, surfaced in a help overlay (principle §6, §9).** The keybinding
   actions (`KEYBINDING_ACTIONS`, resolved via `resolveBinding`) are the single source; add a
   discoverable **shortcuts help overlay** (e.g. `?`) listing them per scope, consumed identically by
   both shells. New actions (new query tab, close tab, focus results) are added to the shared list, not
   hardcoded per component.
4. **Automated a11y checks ride the existing harness (principle §12, pairs with Phase 12).** An
   `axe-core` assertion runs inside Vitest+RTL against key rendered surfaces (modals, forms, grid shell) —
   **no new browser/E2E infra** — so a regression fails a unit test. A headless-browser E2E harness stays
   an optional, unscheduled candidate.
5. **No behavior change beyond accessibility (principle §13).** This adds no product surface — it makes
   existing surfaces reachable/labeled. Any control that changes is cosmetic/interaction-only.

## Backend (`apps/api`)

None — this phase is frontend/UI only. (No new routes, DTOs, or driver work.)

## Frontend (`apps/web` + `packages/ui`)

### Focus, roles, and rings
- Route remaining hand-rolled modals through the Phase-34 `Modal` (or apply the same focus-trap hook);
  add roles/labels/`aria-*` to `SchemaTree`, `WorkspaceTabBar`, `CommandPalette`, `TableView` grid shell,
  and the mobile bottom nav; add a token-based visible focus ring in `tokens.css` and apply it via a
  shared utility.

### Shortcuts registry + help overlay
- Extend `KEYBINDING_ACTIONS` with the missing actions; a `ShortcutsHelp` overlay (built on `Modal`) lists
  resolved chords per scope, opened by a keybinding and from the command palette. Both shells render it.

### Tests (Vitest, `apps/web` — per Phase 12)
- `axe-core` finds no violations on the settings modal, a DDL modal, the connection form, and the grid
  shell; focus is trapped and restored on modal open/close; `Esc` closes; the shortcuts overlay lists the
  registry; grid/tree/tab-bar expose the expected roles/labels.

## Verification

### Manual (any connection)
1. Tab through the app with no mouse: focus is always visible, never trapped off-screen, and reaches every
   interactive control; opening any modal traps focus and `Esc` restores it to the trigger.
2. Press `?` → the shortcuts help overlay lists all actions with their current chords; a remapped chord
   (Phase 21) shows through.
3. A screen reader announces the schema tree (expandable rows), grid, and tab bar with sensible
   roles/labels.
4. Toggle light/dark/accent → the focus ring stays visible and legible in every theme.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Full WCAG-AA certification / a formal audit; screen-reader-specific choreography beyond correct ARIA.
- A headless-browser E2E / visual-regression harness (remains an optional, unscheduled candidate).
- Reflowing layouts beyond the existing mobile-first breakpoints.
