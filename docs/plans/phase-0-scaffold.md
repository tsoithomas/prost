# Prost — Phase 0: Scaffold & Infra (retrospective)

> **Status: ✅ Complete** (commit `12a9691`, "feat(scaffold): bootstrap monorepo and static
> app shell from design system"). This is a retrospective record of what shipped, written
> after the fact for documentation — not a forward plan. It reflects the repo as built.

## Context

Phase 0 stands up the monorepo, local databases, and a **static design-system shell** wired to
mock data — everything needed for Phase 1 to start replacing mocks with real backend calls
without restyling. No real auth, connections, metadata, or grid backend exists yet at this
point; the API is a NestJS bootstrap with `/health` and a tested `CryptoService`.

## What shipped

### Monorepo & tooling
- **pnpm workspaces** (`pnpm-workspace.yaml` → `apps/*`, `packages/*`) + **Turborepo**
  (`turbo.json` with `build`/`lint`/`test`/`dev` pipelines), pnpm pinned via `packageManager`.
- **TypeScript project setup**: `tsconfig.base.json` with path aliases (`@prost/shared-types`,
  `@prost/ui`, `@prost/utils`), resolved two ways kept in sync — TS aliases **and** Vite
  aliases in `apps/web/vite.config.ts` (both point at each package's `src/`).
- **ESLint + Prettier** at the root (`eslint.config.mjs`, `.prettierrc.json`), **Vitest** for
  unit tests.

### Workspace packages
- **`packages/shared-types`** — cross-boundary contracts (`GridResponse`, `ColumnMetadata`,
  `SchemaMetadata`/`TableSummary`, `ConnectionDto` + input DTOs, `QueryResult`, row
  request shapes, `UserDto`, `QueryHistoryDto`, `UserPreferenceDto`, error envelope/codes).
  Many future-phase shapes were defined up front here so both apps share one source of truth
  (principle §6).
- **`packages/utils`** — `quoteIdent` (identifier quoting, the parameterization safety net of
  principle §2) with a Vitest suite.
- **`packages/ui`** — design tokens (`theme/tokens.css`), primitives (`Button`, `Input`,
  `Checkbox`, `Badge`/`StatusDot`, `IconButton`, `Surface`), the AG Grid theme
  (`grid/gridTheme.ts`, `themeQuartz.withParams()` over `var(--color-*)`), the Monaco theme
  (`editor/monacoTheme.ts`, `getComputedStyle` snapshot), and the runtime theme applier
  (`theme/applyTheme.ts`, `theme/accentPresets.ts`).

### Backend bootstrap (`apps/api`)
- NestJS app (`main.ts`, `app.module.ts`, `/health` via `app.controller.ts`).
- **Prisma schema** (`apps/api/prisma/schema.prisma`) modeling the full app DB up front:
  `User`, `Connection` (with `encryptedCredentials` JSON, **no plaintext password column**),
  `QueryHistory`, `UserPreference`. Seed script for the admin user from env.
- **`CryptoService`** (`common/crypto.service.ts`) — AES-256-GCM encrypt/decrypt with a unit
  test (`crypto.service.test.ts`), ready for connection-credential encryption in Phase 1.

### Frontend shell (`apps/web`)
- React 19 + Vite + Tailwind v4 + React Router + Zustand, wired with **mock data**
  (`apps/web/src/mocks/`).
- **Responsive shell split** (`layout/AppLayout.tsx` + `useIsMobile()`): two entirely separate
  shells — desktop (`TopBar` + `Sidebar` + `StatusBar`) and `MobileShell` (top bar + bottom
  nav + bottom-sheet menu) — per the mobile navigation model (principle §9, spec §8.5).
- **Theming live from day one**: `stores/themeStore.ts` (Zustand + `persist`, runtime source of
  truth for `colorMode`/`accentColor`), the no-flash pre-hydration inline script in
  `index.html`, Settings/Theme panels, and grid/Monaco re-theming.

### Local infra
- **`docker-compose.yml`**: `prost-postgres` (app DB, host port 5433) + `demo-target-postgres`
  (host port 5434, seeded from `docker/demo-target-init.sql` with `users`/`orders`/`products`
  to serve as a real target DB for Phase 1+, matching the mock data shape).
- **`.env.example`** documenting `DATABASE_URL`, `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`,
  `QUERY_TIMEOUT_MS`, admin seed vars, and `VITE_API_URL`.

## Outcome

`pnpm -w build`/`lint`/`test` pass; `docker compose up -d` brings up both Postgres instances;
the web app renders the full desktop + mobile shell against mocks with working theming. This is
the foundation Phase 1 builds on — every visual surface exists, so Phase 1 swaps mock imports
for real data without restyling.

## Notes / deviations from spec

- The spec sketches a `spec/` directory and a `packages/ui/src/grid/DataGrid.tsx`; the actual
  build keeps the spec under `docs/plans/prost-mvp.md` and themes AG Grid directly via
  `gridTheme.ts` rather than a wrapper component. These are immaterial to the architecture
  principles.
- Several backend modules named in the spec (`Query`, `Grid`, `History`, `Preference`) are
  **not** present in Phase 0 — they arrive in their respective phases. The Prisma schema,
  however, models all of them up front.
