# Prost — Phase 12: Frontend Test Foundation

## Context

`apps/api` has 14 Vitest specs covering services, the crypto layer, editability, and paging;
`packages/utils` tests `quoteIdent` and `parseConnectionString`. **`apps/web/src` has zero
tests.** The most user-facing, highest-stakes logic in the product — the editability-gated grid,
the DDL preview/confirm modals, theme hydration (server-vs-localStorage precedence), the
connection-string parse UI, and the AI `ChatPanel` — is the least protected against regression.

This phase establishes a frontend test harness and backfills the high-value, logic-bearing UI, so
that **every feature phase from 13 onward ships with web tests** — the same discipline the API
already enforces. It is the second "strengthening" phase and is independent of all others; it
should land early precisely so later phases can lean on it.

## Decisions (to confirm before building)

1. **Vitest + React Testing Library + `jsdom`**, matching the existing Vitest setup (no new test
   runner). RTL because principle §4/§9 mean we test **behaviour as the user sees it** (rendered
   output, interactions), not component internals.
2. **Mock the network at the boundary, never hit a real backend.** Stub the `apps/web/src/api/*`
   hooks (or MSW over `fetch`) so tests are deterministic and offline. This keeps the
   frontend/backend contract honest via `@prost/shared-types` (principle §6) without coupling
   tests to a running API.
3. **Prioritise logic, not pixels.** v1 targets the components where a regression is *silent and
   dangerous*: editability gating, DDL preview/confirm + danger gates, theme precedence, the
   connection-string parser UI, history/chat load-into-editor. Pure-presentational components and
   visual regression are explicitly out of scope (consistent with Phase 5's deferral of
   visual-regression infra).
4. **Both shells matter (principle §9).** Where a component has a desktop and mobile variant
   (`layout/` vs `mobile/`), test the shared logic once and assert the responsive split renders
   the right shell via the `useIsMobile` seam — don't duplicate the whole suite per breakpoint.
5. **Wire it into CI/turbo.** `pnpm -w test` must run web tests too; add the `test` script to
   `apps/web` and ensure the turbo pipeline picks it up, so red web tests block a merge like API
   tests do.

## Backend (`apps/api`)

None. This phase is frontend-only.

## Frontend (`apps/web`)

### Harness
- Add `vitest` + `@testing-library/react` + `@testing-library/user-event` + `jsdom` (or
  `happy-dom`) dev deps; a `vitest.config.ts` (or extend root) with the jsdom environment and the
  existing Vite aliases (so `@prost/*` resolves to `src/`, matching `vite.config.ts`).
- A `src/test/setup.ts`: RTL matchers, `matchMedia` polyfill (needed by `useMediaQuery`), a
  helper to render with the Zustand stores + router in a known state.
- A reusable API-mock layer (stub the `src/api/*` hooks or MSW handlers) returning shapes typed by
  `@prost/shared-types`.

### Backfill suites (the high-value targets)
- **Editability gating** — given a `QueryResult` the backend marks non-editable, the grid renders
  read-only; editable → inline editing wired. (Mirrors the §4 server contract from the client side.)
- **DDL modals** (`CreateTableModal`, `AddColumnModal`, `EditColumnModal`, `CreateIndexModal`) —
  live SQL preview reflects inputs; the confirm/danger gate fires before any mutation hook is
  called (principle §8); drops show the danger spelling.
- **Theme hydration** (`themeStore`) — server preference wins over `localStorage`; a preset change
  writes through; `applyTheme` sets the accent inline-style path.
- **Connection-string import** (`ConnectionModal` + `parseConnectionString`) — pasting a
  `postgres://…` string fills host/port/db/user/password/SSL; malformed strings surface an error,
  don't silently mis-fill.
- **Load-into-editor** — `QueryHistoryList` and `ChatPanel` SQL blocks call
  `workspaceStore.loadQuery` (never auto-run — Phase 10 Decision 2).
- **Responsive shell** — `AppLayout` renders the desktop shell vs `MobileShell` per `useIsMobile`.

### Tests (Vitest, `apps/web`)
The suites above *are* the deliverable. Aim for meaningful coverage of branching logic, not a
coverage-percentage target; document in the PR what is deliberately untested (pure presentation).

## Verification

### Unit (Vitest)
`pnpm --filter @prost/web test` runs green; `pnpm -w test` now includes web tests and the turbo
pipeline fails on a red web test.

### Manual
1. Introduce a deliberate regression (e.g. make the grid editable regardless of the backend flag)
   → the editability suite goes red. Revert → green. Confirms the tests bite.
2. `pnpm -w test` from the repo root runs API + utils + web suites in one pass.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Visual-regression / cross-browser / screenshot testing infrastructure (deferred since Phase 5).
- End-to-end / browser-automation (Playwright) tests against a live stack — unit/integration at
  the component boundary only in v1.
- A coverage-threshold gate — start by covering the high-value surfaces; ratchet later if desired.
- Retrofitting tests for every presentational component; this phase targets logic-bearing UI.
