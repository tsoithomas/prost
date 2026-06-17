# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Prost is a web-based PostgreSQL client (TablePlus-style) for internal developer use:
connection management, schema browsing, table viewing/editing, and a SQL editor with
query results. Full spec: [`docs/plans/prost-mvp.md`](docs/plans/prost-mvp.md). Per-phase
implementation plans + status live in [`docs/plans/`](docs/plans/README.md). Durable
architectural rules (read before making non-trivial changes — a violation is a defect
even if it works): [`docs/architecture-principles.md`](docs/architecture-principles.md).

**Current status**: All phases 0–10 complete. Login (JWT via `/auth/login`, guarded `/app/*`
routes), connection CRUD + test (`/connections`), real schema tree
(`/connections/:id/metadata`), paginated table rows via AG Grid's Infinite Row Model
(`/connections/:id/tables/:schema/:table/rows`) with inline cell editing + row insert/delete,
and a Monaco SQL editor wired to real execution (`POST /connections/:id/query`) with a
server-side editability analyzer — results render in the same grid, editable only when the
backend says so. Every successful query is recorded server-side via `HistoryModule`
(`GET /connections/:id/history`), surfaced as a recent-queries panel in the Sidebar's History
tab and mobile Settings — clicking an entry loads it back into Monaco. Per-user
`colorMode`/`accentColor` preferences persist via `PreferenceModule`
(`GET`/`PATCH /preferences`), hydrating `themeStore` once per session (server wins over
`localStorage`) and writing through on every preset change. A shared `ConfirmDialog`/
`useConfirm()` (centered on desktop, full-width bottom sheet on mobile) replaces all
`window.confirm()` calls, and mobile touch targets (≥44px), safe-area-aware bottom nav, and
a results-favoring SQL editor split (`max-md:h-2/5`/`h-3/5`) round out the responsiveness
hardening pass. `ConnectionModal` can also parse a pasted `postgres://`/`postgresql://`
connection string (`parseConnectionString` in `@prost/utils`) to fill in the host/port/
database/user/password/SSL fields.

**Phases 7–10 (post-MVP)**: A read-only `TableStructurePanel` (Phase 7) shows columns +
indexes for the active table tab. `DdlModule` (`DdlService`, `DdlController`) handles all DDL
writes: create table with column builder and preview (Phase 8); alter table (add/drop/rename
columns, set NOT NULL / DEFAULT / type), create index, drop index — all with live SQL preview
and `useConfirm` danger gates (Phase 9). Phase 10 adds an `AiModule` with `RetrievalService`
(schema-only context, ≤8k chars, Decision-1 guard that no credentials or row data leak into the
prompt) and `AiService` (`POST :id/ai/chat`). LLM providers are **user-managed**: an
`LlmEndpoint` Prisma model (per-user, OpenAI-compatible `baseUrl` + `models[]` + API key
encrypted at rest via the shared `CryptoService`, same as connection credentials) with CRUD at
`/llm-endpoints` (`LlmEndpointService`/`LlmEndpointController`). `AiProviderService` uses the
`openai` SDK, building a client per-call from the chosen endpoint's `baseUrl`/`apiKey`/`model`
(any OpenAI-compatible API — OpenAI, Ollama, LM Studio, OpenRouter, …); there are **no AI env
vars**. `AiService.chat` resolves the endpoint, validates the requested `model` belongs to it
(400 otherwise), then calls the provider; provider failures map to a safe
`ServiceUnavailableException`. The frontend `ChatPanel` (with a model picker `<optgroup>` per
endpoint + a gear opening `LlmEndpointsModal`) lives in a **collapsible right sidebar**
(`RightSidebar`, toggled from `TopBar`/`aiStore`) on desktop and the bottom-nav "AI" tab on
mobile. SQL blocks in replies have a "Load into editor" button (`workspaceStore.loadQuery`); no
auto-execution. When a user has no endpoints, the panel shows an "add an endpoint" empty state.

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

## Commit messages

Conventional Commits, `type(scope): subject` — enforced by `.releaserc.json` /
`.github/workflows/release.yml` (semantic-release), which bumps `package.json`'s version
on every push to `main`:

- `feat: ...` → minor bump (`0.x.0`)
- `fix: ...` / `perf: ...` → patch bump (`0.x.y`)
- `BREAKING CHANGE:` footer (or `type!:`) → major bump
- `chore:`, `docs:`, `refactor:`, `test:`, `style:`, `ci:`, `build:` → no release

Scope = the area touched, e.g. `api`, `web`, `ui`, `shared-types`, `utils`, `phase1`,
`scaffold`. Subject in imperative mood, no trailing period.

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
- **Target DBs** (the databases users connect to/manage) — reached only through
  `PoolManager` (`apps/api/src/database/`), the single choke point that owns pool
  caching, idle-sweep, and LRU eviction, delegating all native connection work to a
  `DbDriver`. There is **one driver per engine**, resolved per `Connection.engine` via the
  engine-keyed `DbDriverRegistry`; `PgDriver` (`apps/api/src/database/drivers/pg/`) is the
  only driver today.
- All dialect-specific SQL — quoting, placeholders, and the metadata/CRUD/DDL query
  builders — lives in the driver. The builders in `pg-sql.ts` are pure functions returning
  `{ sql, params }` fragments; feature services (`metadata`/`grid`/`ddl`/`query`) hold **no
  raw target SQL** and reach builders only via the driver. Adding a new engine = implement
  `DbDriver` + register it in `DatabaseModule`'s `DB_DRIVERS`, with the conformance suite
  `runDriverContractTests` (`apps/api/src/database/testing/`) proving it conforms.
- Prisma never touches a target DB; the driver layer never touches the app DB. No target
  credential, schema, or row data ever lands in an app-DB table. All target SQL is
  parameterized; identifiers go through the driver's `quoteIdent` (built on
  `quoteIdent` in `packages/utils`) — never raw string concatenation.

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
