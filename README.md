# Prost

A web-based PostgreSQL client (TablePlus-style) for internal developer use: connection
management, schema browsing, table viewing/editing, and a SQL editor with query results.

> **Status:** MVP (Phases 1–5) complete — login, connection management, real schema browsing,
> a paginated/editable table grid, a SQL editor with query history, and theming/responsiveness
> hardening all work end-to-end. Phase 6 (paste a `postgres://` connection string into
> "New Connection") is also complete; Phases 7–10 (schema/index viewing & editing, create
> table, AI chat) are planned. See [`docs/plans/`](docs/plans/README.md) for per-phase plans
> and status.

## Highlights

- 🔐 **JWT auth** with a seeded admin (no public sign-up); every data route is guarded.
- 🗄️ **Connection management** — create/test/edit/delete, or paste a `postgres://` connection
  string to fill in the form; target-DB credentials encrypted at rest (AES-256-GCM), never
  returned to the client.
- 🌳 **Schema explorer** — real schemas/tables/columns/primary keys from system catalogs.
- 📊 **Data grid** — AG Grid with server-side pagination (Infinite Row Model); built to stay
  responsive on tables of 100,000+ rows.
- 🎨 **Theming** — light/dark/system color mode + user-selectable accent, no flash on load,
  applied consistently across the grid and Monaco editor.
- 📱 **Responsive** — separate desktop (sidebar) and mobile (bottom-nav + bottom-sheet) shells.

## Architecture

Prost touches **two kinds of database that must never be confused** (the project's first
architectural principle):

- **Application DB** — Prost's own data (users, saved connections, preferences, query
  history). Accessed **only** through Prisma.
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
  shared-types/        GridResponse, ColumnMetadata, DTOs — imported by both apps
  ui/                  design tokens, primitives, AG Grid theme, Monaco theme
  utils/               framework-free helpers (e.g. quoteIdent)
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

# 5. Run everything (web on :5173, api on :3001)
pnpm -w dev
```

Then open <http://localhost:5173/app> and log in with the admin credentials from your `.env`
(`ADMIN_EMAIL` / `ADMIN_PASSWORD`). The seeded `demo-target-postgres` (port 5434, db `demo`,
user/password `demo`) is a ready-made target DB with `users`/`orders`/`products` tables.

## Common commands

```sh
pnpm -w build        # build all packages/apps (turbo)
pnpm -w lint         # eslint across the workspace
pnpm -w test         # vitest (packages/utils + apps/api)
pnpm -w dev          # run all dev servers

pnpm --filter @prost/web dev    # just the frontend
pnpm --filter @prost/api dev    # just the backend (watch mode)
pnpm format                     # prettier --write .
```

Run a single test:

```sh
pnpm --filter @prost/utils test -- quoteIdent
pnpm --filter @prost/api test -- crypto.service
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
