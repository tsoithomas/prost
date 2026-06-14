# Prost

A web-based PostgreSQL client (TablePlus-style) for internal developer use: connection
management, schema browsing, table viewing/editing, and a SQL editor with query results.

> **Status:** Phases 0–16 complete. See [`docs/plans/README.md`](docs/plans/README.md) for
> per-phase status and [`docs/plans/roadmap-phase-11-22.md`](docs/plans/roadmap-phase-11-22.md)
> for the remaining backlog (Phases 17–22: schema-aware autocomplete, deeper grid editing,
> history management, global search, expanded preferences, streaming results).

## Features

- 🔐 **JWT auth** — seeded admin account (no public sign-up); every data route is guarded.
- 🗄️ **Connection management** — create/test/edit/delete; paste a `postgres://` URI to fill
  the form; target-DB credentials encrypted at rest (AES-256-GCM), never returned to the
  client.
- 🌳 **Schema explorer** — real schemas/tables/columns/primary keys from system catalogs, with
  a resizable sidebar.
- 📊 **Data grid** — AG Grid with server-side pagination (Infinite Row Model); stays
  responsive on tables of 100k+ rows. Inline cell editing, row insert, and row delete where the
  backend deems the result editable.
- 🔍 **Row filtering** — structured `WHERE` builder per column (=, ≠, contains, starts with,
  ends with, is null, IN, NOT LIKE, …) compiled to parameterized SQL server-side.
- 🏗️ **Schema management** — read-only table structure (columns + indexes) plus DDL writes:
  create table (with column builder and live SQL preview), alter table (add/drop/rename columns,
  set NOT NULL / DEFAULT / type), create index, drop index — all gated behind a
  preview → confirm → execute flow.
- 📝 **SQL editor** — Monaco with multi-statement script execution, a server-side editability
  analyzer, query history, and saved snippets. Results render per-statement in stacked panels.
- 🔀 **Multi-statement scripts** — run any number of SQL statements in one shot; each
  statement gets its own result panel (rows grid, command tag, plan text, or error) with
  per-statement timing.
- 💱 **Transactions** — "Run as transaction" toggle wraps the batch in `BEGIN`/`COMMIT`,
  rolling back on any error; a rolled-back badge shows how many of N statements ran.
- 📋 **EXPLAIN / EXPLAIN ANALYZE** — plan output rendered verbatim in a monospace panel;
  `ANALYZE` (or `EXPLAIN (ANALYZE, BUFFERS)`) shows real timings with a "This executes"
  warning badge.
- 🔖 **Saved snippets** — bookmark any query with a name, browse from the Sidebar's Snippets
  tab, click to load back into the editor.
- 🗂️ **Multi-query tabs** — independent SQL buffers per tab, each with its own result,
  transaction toggle, and cursor position.
- 📜 **Query history** — every successful query recorded server-side; browsable in the
  Sidebar's History tab and mobile Settings; click to reload into Monaco.
- 🤖 **AI assistant** — chat panel grounded by retrieval over schema metadata (≤8 k chars; no
  credentials or row data ever sent). User-managed OpenAI-compatible LLM endpoints (OpenAI,
  Ollama, LM Studio, OpenRouter, …) with per-user API-key encryption. "Load into editor" for
  suggested SQL — never auto-run.
- 🎨 **Theming** — light/dark/system color mode + user-selectable accent color; no flash on
  load; applied consistently across the grid and Monaco editor; preference synced to the server
  and persisted across sessions.
- 📱 **Responsive** — separate desktop (resizable left/right sidebars + top bar + status bar)
  and mobile (bottom-nav + bottom-sheet) shells; safe-area-aware; touch targets ≥ 44 px.

## Architecture

Prost touches **two kinds of database that must never be confused** (the project's first
architectural principle):

- **Application DB** — Prost's own data (users, saved connections, preferences, query
  history, snippets). Accessed **only** through Prisma.
- **Target DBs** — the PostgreSQL databases users connect to. Accessed **only** through the
  raw `pg` driver, funneled through a single `PgConnectionService` choke point with fully
  parameterized SQL (identifiers quoted via `quoteIdent`, values bound as `$n`).

The durable rules every change must obey live in
[`docs/architecture-principles.md`](docs/architecture-principles.md); the full product/
engineering spec is [`docs/plans/prost-mvp.md`](docs/plans/prost-mvp.md).

## Tech stack

| Layer | Stack |
| --- | --- |
| **Frontend** (`apps/web`) | React 19, Vite, Tailwind v4, React Router, Zustand, TanStack Query, AG Grid, Monaco |
| **Backend** (`apps/api`) | NestJS 11, Prisma (app DB), `pg` (target DBs), JWT, class-validator |
| **Shared** (`packages/*`) | `shared-types` (cross-boundary DTOs), `ui` (tokens + primitives + grid/editor themes), `utils` (`quoteIdent`) |
| **Tooling** | pnpm workspaces, Turborepo, TypeScript, ESLint + Prettier, Vitest |

```
apps/
  web/                 React + Vite + TS frontend
  api/                 NestJS + TS backend (app DB only)
packages/
  shared-types/        GridResponse, StatementResult, ColumnMetadata, DTOs — imported by both apps
  ui/                  design tokens, primitives, AG Grid theme, Monaco theme
  utils/               framework-free helpers (e.g. quoteIdent, parseConnectionString)
docs/                  spec, architecture principles, per-phase plans
docker-compose.yml     local app Postgres + demo target Postgres
```

## Getting started

### Prerequisites

- **Node** ≥ 22.14
- **pnpm** 9.15 (pinned via `packageManager`; if not on PATH, prefix commands with
  `npx --yes pnpm@9.15.0`)
- **Docker** (for local Postgres)

### Setup

```sh
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # then fill in JWT_SECRET, CREDENTIAL_ENCRYPTION_KEY, admin creds

# 3. Start local databases (app DB on :5433, demo target DB on :5434)
docker compose up -d

# 4. Apply the schema and seed the admin user
pnpm --filter @prost/api prisma:migrate
pnpm --filter @prost/api prisma:seed

# 5. Run everything (web on :5173, api on :3010)
pnpm -w dev
```

Then open <http://localhost:5173/app> and log in with the admin credentials from your `.env`
(`ADMIN_EMAIL` / `ADMIN_PASSWORD`). The seeded `demo-target-postgres` (port 5434, db `demo`,
user/password `demo`) is a ready-made target DB with `users`/`orders`/`products` tables.

## Common commands

```sh
pnpm -w build        # build all packages/apps (turbo)
pnpm -w lint         # eslint across the workspace
pnpm -w test         # vitest (packages/utils + apps/api + apps/web)
pnpm -w dev          # run all dev servers

pnpm --filter @prost/web dev    # just the frontend
pnpm --filter @prost/api dev    # just the backend (watch mode)
pnpm format                     # prettier --write .
```

Run a single test:

```sh
pnpm --filter @prost/utils test -- quoteIdent
pnpm --filter @prost/api test -- query.service
pnpm --filter @prost/web test -- SqlEditorView
```

## Releases

Versioning is automated with [semantic-release](https://semantic-release.gitbook.io/) on
pushes to `main`, driven by [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` → minor, `fix:`/`perf:` → patch, `BREAKING CHANGE:` → major. Each release creates a
git tag and a GitHub Release (the changelog lives on the
[Releases page](https://github.com/tsoithomas/prost/releases)); CI does not commit back to the
branch. See the commit-message conventions in [`CLAUDE.md`](CLAUDE.md#commit-messages).

## License

[MIT](LICENSE) © Thomas Tsoi
