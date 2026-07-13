# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Prost is a web-based, multi-engine database client (TablePlus-style) for internal developer
use — PostgreSQL, MySQL 8.0+, and SQLite — covering connection management, schema browsing,
table viewing/editing, and a SQL editor with query results. Full spec:
[`docs/plans/prost-mvp.md`](docs/plans/prost-mvp.md). Per-phase
implementation plans + status live in [`docs/plans/`](docs/plans/README.md). Durable
architectural rules (read before making non-trivial changes — a violation is a defect
even if it works): [`docs/architecture-principles.md`](docs/architecture-principles.md).

**Current status**: All phases 0–23 complete. Login (JWT via `/auth/login`, guarded `/app/*`
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
hardening pass. `ConnectionModal` can also parse a pasted `postgres://`/`postgresql://`/
`mysql://` connection string (`parseConnectionString` in `@prost/utils`, which infers the
engine and its default port) to fill in the host/port/database/user/password/SSL fields.

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

**Phases 11–22 (post-MVP wave 2)**: reliability & abuse hardening (throttling, pool idle/LRU
lifecycle, an editability fail-safe) (11) and a frontend test foundation (Vitest + RTL,
`renderWithProviders`) (12); saved snippets (`SnippetList`) (13); per-column row filtering — a
`RowFilter` compiled by `grid/filter.ts` and driven by `FilterPanel` (14); multi-query tabs via a
`workspaceStore` refactor (15); multi-statement scripts, transactions, and `EXPLAIN` (16);
schema-aware Monaco autocomplete + SQL formatting (17); grid-editing depth — type-aware editors,
staged bulk edits (`useEditBuffer`) with undo/redo and column pin/group (18); query-history
management (edit/star/delete, search, export) (19); a command-palette global search
(`CommandPalette`) (20); preferences & theming expansion, incl. per-column render overrides (21);
and streaming cursor-based large result sets (`POST :id/query/cursor`, forward-only
`DriverCursor`) (22).

**Phase 23 (foreign keys + relational navigation)**: a capability-uniform `buildListForeignKeys` /
`buildListReferencingForeignKeys` per driver (PG `pg_constraint`, MySQL
`KEY_COLUMN_USAGE`/`REFERENTIAL_CONSTRAINTS`, SQLite `pragma_foreign_key_list`) surfaces
`ForeignKeyMetadata` end-to-end. `MetadataService.getTableStructure` gains `foreignKeys` (a
read-only Foreign-keys section in `TableStructurePanel`), and `GridResponse` carries `foreignKeys`
+ `referencingKeys` (best-effort, fetched only on the first page). In the grid, a cell context
menu (right-click / long-press) offers "open referenced row" (forward) and "show referencing rows"
(reverse); both compile to a parameterized Phase-14 `RowFilter` via `buildFkNavTargets` (in
`grid/fkNavigation.ts`) and open the target as a table tab seeded through `workspaceStore`'s
one-shot `presetFilter`. Read + navigate only — FK-constraint DDL and ER diagrams stay out of scope.

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

Local demo target databases for manual testing (the app DB itself is file-based SQLite — no
service; `prisma:migrate` writes to `apps/api/prisma/data/prost.db`):

```sh
docker compose up -d                      # demo-target-postgres :5434, demo-target-mysql :3307
pnpm --filter @prost/api prisma:migrate   # apply Prisma schema to the SQLite app DB
pnpm --filter @prost/api prisma:seed      # create admin user from ADMIN_EMAIL/ADMIN_PASSWORD
```

`demo-target-postgres` (port 5434, `docker/demo-target-init.sql`) and `demo-target-mysql`
(MySQL 8.0, port 3307, `docker/demo-target-mysql-init.sql`) are both seeded with
`users`/`orders`/`products` (the MySQL one adds a composite-key `order_items`) — useful as real
target DBs, and the Postgres shape matches the mock data in `apps/web/src/mocks/`. The shared
driver conformance suite (`*-driver.contract.test.ts`) runs against both live engines; set
`REQUIRE_LIVE_DRIVER_CONTRACTS=true` (as CI does) to fail rather than skip when one is down.

## Commit messages

Conventional Commits, `type(scope): subject` — enforced by `.releaserc.json` /
`.github/workflows/ci.yml`'s `release` job (semantic-release). This is **tag-only**: it
creates a git tag + GitHub Release on every push to `main` but does **not** bump
`package.json` (frozen at `1.0.0`) or write a `CHANGELOG.md`. The git tag is the version of
truth; `apps/web/vite.config.ts` injects it into the StatusBar at build time (via the
`APP_VERSION` build arg in CI/Docker, or `git describe` locally). The commit type drives the
bump:

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
  engine-keyed `DbDriverRegistry`: `PgDriver` (`drivers/pg/`, the `pg` Pool), `MysqlDriver`
  (`drivers/mysql/`, a `mysql2` Pool — `?` placeholders, no `RETURNING`, parser dialect
  `mysql`, `supportsSchemas: false`), and `SqliteDriver` (`drivers/sqlite/`, a `better-sqlite3`
  handle — `database` holds the file path or `:memory:`; capabilities `supportsSchemas: false`,
  parser dialect `sqlite`).
- **MySQL specifics** (8.0+; MariaDB and pre-8.0 are rejected at `testConnection` and pool
  creation via `SELECT VERSION()`): a connection browses **only its own `database`** (sibling
  databases on the server are never listed — "schema" maps to that one database). Since MySQL
  has no `RETURNING`, `insertRow`/`updateRow` are **executing methods** (the driver runs the
  statement on a pinned connection, then re-selects the row by primary key). An insert must
  carry a **complete primary key**, or omit **exactly one** missing `AUTO_INCREMENT` PK
  component (resolved from `LAST_INSERT_ID()`); any other shape throws
  `UnprocessableEntityException` (**HTTP 422**) **before** any mutation runs. MySQL URIs use the
  `mysql://` scheme; TLS follows the connection's `sslEnabled`/`sslRejectUnauthorized` like PG.
  Indexes advertise BTREE only. None of this lives in feature services — it's all in the driver
  + its `descriptor` (the frontend consumes the descriptor, never hardcodes engine policy).
- Feature services hold **no driver reference and no raw target SQL**: they resolve the right
  driver per call via `PoolManager.driverFor(connectionId)`, then reach the dialect's pure
  `{ sql, params }` builders (`pg-sql.ts` / `mysql-sql.ts` / `sqlite-sql.ts`) through it. The grid filter
  compiler (`grid/filter.ts`) and query pager (`query/paging.ts`) take the driver's
  `whereDialect`/`placeholder` so they stay engine-neutral. Adding a new engine = implement
  `DbDriver` + register it in `DatabaseModule`'s `DB_DRIVERS`, with the conformance suite
  `runDriverContractTests` (`apps/api/src/database/testing/`, capability-aware — engines
  without schemas skip `CREATE SCHEMA`) proving it conforms.
- Prisma never touches a target DB; the driver layer never touches the app DB. No target
  credential, schema, or row data ever lands in an app-DB table. All target SQL is
  parameterized; identifiers go through the driver's `quoteIdent` (built on
  `quoteIdent` in `packages/utils`) — never raw string concatenation.
- **SQLite is meant for inspecting Prost's own data**: set `APP_DB_SQLITE_PATH` and
  `prisma:seed` idempotently provisions exactly one `engine = 'sqlite'` connection (owned by
  the admin) pointing at that file. This is a sanctioned exception to the boundary
  (principle #1) — it still flows through `PoolManager`/`SqliteDriver`, never the app's
  Prisma client. Native note: `better-sqlite3` compiles/loads a native binary, allowlisted in
  the root `package.json` `pnpm.onlyBuiltDependencies`. Rich DDL for SQLite is intentionally
  out of scope (its `ALTER TABLE` is limited; `sqlite-sql.ts` throws for retype/NOT NULL/
  default changes).

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
