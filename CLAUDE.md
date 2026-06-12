# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Prost is a web-based PostgreSQL client (TablePlus-style) for internal developer use:
connection management, schema browsing, table viewing/editing, and a SQL editor with
query results. Full spec: [`docs/plan/prost-mvp.md`](docs/plan/prost-mvp.md). Durable
architectural rules (read before making non-trivial changes — a violation is a defect
even if it works): [`docs/architecture-principles.md`](docs/architecture-principles.md).

**Current status**: Phase 0 only — pnpm/Turborepo scaffold plus a static design-system
app shell (desktop + mobile) wired with mock data (`apps/web/src/mocks/`). There is no
real auth, connection, metadata, or grid backend yet (Phase 1+). Don't assume routes,
guards, or API calls exist beyond the NestJS `/health` endpoint and the `CryptoService`.

## Commands

Package manager is pnpm (pinned via `packageManager` in `package.json`). If `pnpm` isn't
on PATH, use `npx --yes pnpm@9.15.0 <command>`.

```sh
pnpm install                 # install all workspace deps

pnpm -w build                # turbo: build all packages/apps
pnpm -w lint                 # turbo: eslint across all packages/apps
pnpm -w test                 # turbo: vitest in packages/utils + apps/api
pnpm -w dev                  # turbo: run all dev servers (web on :5173, api on :3001)

pnpm --filter @prost/web dev       # just the frontend
pnpm --filter @prost/api dev       # just the backend (NestJS, watch mode)

pnpm format                  # prettier --write .
```

Run a single test (vitest, no config file — defaults apply):

```sh
pnpm --filter @prost/utils test -- quoteIdent      # or: cd packages/utils && npx vitest run quoteIdent
pnpm --filter @prost/api test -- crypto.service
```

Local Postgres (app DB + demo target DB for manual testing):

```sh
docker compose up -d
pnpm --filter @prost/api prisma:migrate   # apply Prisma schema to prost-postgres (port 5433)
pnpm --filter @prost/api prisma:seed      # create admin user from ADMIN_EMAIL/ADMIN_PASSWORD
```

`demo-target-postgres` (port 5434) is seeded from `docker/demo-target-init.sql` with
`users`/`orders`/`products` — useful as a real target DB for Phase 1+ work, and its
shape matches the mock data already in `apps/web/src/mocks/`.

## Monorepo layout & path aliases

```
apps/web        React 19 + Vite + Tailwind v4 + React Router + Zustand
apps/api        NestJS 11 (apps DB only — see "two-database boundary" below)
packages/shared-types   cross-boundary DTOs/types, imported by both apps
packages/ui     design tokens, primitives, AG Grid theme, Monaco theme
packages/utils  framework-free helpers (e.g. quoteIdent)
```

`@prost/shared-types`, `@prost/ui`, `@prost/utils` are pnpm workspace packages resolved
two ways that must be kept in sync: TS path aliases in `tsconfig.base.json` *and* Vite
aliases in `apps/web/vite.config.ts` (both point at each package's `src/`, not `dist/`).

## The two-database boundary (critical)

This is principle #1 in `docs/architecture-principles.md` and shapes `apps/api`:

- **App DB** (users, connections, history, preferences) — Prisma only
  (`apps/api/prisma/schema.prisma`).
- **Target DBs** (the Postgres databases users connect to/manage) — raw `pg` driver
  only, through a single `PgConnectionService` / `runParameterized` choke point
  (Phase 1+, not yet built).
- Prisma never touches a target DB; `pg` never touches the app DB. No target credential,
  schema, or row data ever lands in an app-DB table. All target SQL is parameterized;
  identifiers go through `quoteIdent` (`packages/utils`) — never raw string
  concatenation.

## Theming system

Single source of truth: `packages/ui/src/theme/tokens.css`, imported once from
`apps/web/src/main.tsx` as `'@prost/ui/theme/tokens.css'`.

- Semantic CSS custom properties (`--color-bg`, `--color-surface`, `--color-text`,
  `--color-accent`, `--color-data-*`, spacing/radius scale) registered via Tailwind v4's
  `@theme` block, with a `.dark { ... }` block overriding the same keys. Components use
  Tailwind utilities built from these tokens (`bg-surface`, `text-accent`, …) —
  **never hardcoded hex values**.
- `--color-accent`/`--color-accent-fg` are set as **inline styles on `<html>`**
  (`packages/ui/src/theme/applyTheme.ts`) rather than baked into `@theme`, since the
  accent is user-selectable at runtime; `--color-accent-hover`/`-muted` derive from it
  via `color-mix()`.
- `apps/web/src/stores/themeStore.ts` (Zustand + `persist`) is the runtime source of
  truth for `colorMode`/`accentColor`, persisted to `localStorage` under `prost-theme`.
  An inline script in `apps/web/index.html` reads that key and applies `.dark` +
  `--color-accent*` **before first paint** to avoid a flash.
- AG Grid (`packages/ui/src/grid/gridTheme.ts`) is themed via `themeQuartz.withParams()`
  using `var(--color-*)` strings directly — it re-resolves on theme change with no JS
  needed. Monaco (`packages/ui/src/editor/monacoTheme.ts`) can't do that; it snapshots
  resolved values via `getComputedStyle` into `monaco.editor.defineTheme` and must be
  re-run after a theme change.

### Tailwind v4 content-scanning gotcha

`apps/web/node_modules/@prost/ui` is a pnpm workspace symlink, and Tailwind's Vite-plugin
scanner excludes `node_modules` by default — so utility classes used *only* inside
`packages/ui/src/**` (never as a literal string in `apps/web/src/**`) silently fail to
generate. `packages/ui/src/theme/tokens.css` has `@source '../**/*.{ts,tsx}';` to fix
this; if you add new Tailwind classes inside `packages/ui` components, this is why they
still work, and don't remove that directive.

## Responsive shell split

`apps/web/src/layout/AppLayout.tsx` uses `useIsMobile()`
(`apps/web/src/hooks/useMediaQuery.ts`, Tailwind `md` breakpoint = 768px) to render
**one of two entirely separate shells** — desktop (`TopBar` + `Sidebar` +
`StatusBar`) or `MobileShell` (top bar + bottom nav + bottom-sheet menu) — not a
responsively-collapsing single layout. New top-level UI generally needs a variant in
both `apps/web/src/layout/` and `apps/web/src/mobile/`.
