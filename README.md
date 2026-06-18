# Prost

A web-based, multi-engine database client (TablePlus-style) for internal developer use:
connection management, schema browsing, table viewing/editing, and a SQL editor with query
results. Connect to **PostgreSQL**, **MySQL 8.0+**, or a **SQLite** file through one consistent
UI — each engine resolved behind a single driver seam (see [Supported engines](#supported-engines)).

> **Status:** Phases 0–16 complete. See [`docs/plans/README.md`](docs/plans/README.md) for
> per-phase status and [`docs/plans/roadmap-phase-11-22.md`](docs/plans/roadmap-phase-11-22.md)
> for the remaining backlog (Phases 17–22: schema-aware autocomplete, deeper grid editing,
> history management, global search, expanded preferences, streaming results).

## Features

- 🔐 **JWT auth** — seeded admin account (no public sign-up); every data route is guarded.
- 🗄️ **Connection management** — create/test/edit/delete; paste a `postgres://` or `mysql://`
  URI to fill the form; target-DB credentials encrypted at rest (AES-256-GCM), never returned
  to the client.
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
- **Target DBs** — the databases users connect to (PostgreSQL, MySQL, or SQLite). Accessed
  **only** through the engine-neutral driver layer: a single `PoolManager` choke point that
  resolves one `DbDriver` per `Connection.engine` (`PgDriver`, `MysqlDriver`, `SqliteDriver`).
  All SQL is fully parameterized — identifiers quoted via each driver's `quoteIdent`, values
  bound through its positional placeholder (`$n` for PG, `?` for MySQL/SQLite). Feature
  services hold no engine branches; engine-specific policy travels through the driver and its
  descriptor.

The durable rules every change must obey live in
[`docs/architecture-principles.md`](docs/architecture-principles.md); the full product/
engineering spec is [`docs/plans/prost-mvp.md`](docs/plans/prost-mvp.md).

### Supported engines

| Engine | Versions | Namespace browsed | URI schemes | TLS |
| --- | --- | --- | --- | --- |
| **PostgreSQL** | 12+ | all schemas | `postgres://`, `postgresql://` | optional |
| **MySQL** | **8.0+** (MariaDB is **not** supported and is rejected at connect time) | the connection's own database only — sibling databases on the server are not listed | `mysql://` | optional |
| **SQLite** | file / `:memory:` | `main` | — (file path, not a network URI) | — |

MySQL specifics worth knowing:

- **Connected-database-only browsing.** A MySQL connection's `database` is its single
  namespace; Prost never enumerates other databases on the server.
- **MariaDB and pre-8.0 are refused.** Both `testConnection` and pool creation read
  `SELECT VERSION()` and throw if the server is MariaDB or older than MySQL 8.0.
- **Deterministic insert-key derivation.** MySQL has no `RETURNING`, so inserts/updates execute
  the statement and re-select the row by primary key. An insert must supply a **complete primary
  key**, or omit **exactly one** missing `AUTO_INCREMENT` primary-key component (filled from
  `LAST_INSERT_ID()`). Any other shape is rejected with **HTTP 422 before any mutation runs**.
- **Indexes advertise BTREE only**; rich `ALTER`/index features mirror the PostgreSQL flow,
  driven by the engine descriptor rather than hardcoded UI policy.

## Tech stack

| Layer | Stack |
| --- | --- |
| **Frontend** (`apps/web`) | React 19, Vite, Tailwind v4, React Router, Zustand, TanStack Query, AG Grid, Monaco |
| **Backend** (`apps/api`) | NestJS 11, Prisma (app DB), `pg` / `mysql2` / `better-sqlite3` (target DBs), JWT, class-validator |
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
docker-compose.yml     demo target databases (Postgres :5434, MySQL :3307)
```

## Getting started

### Prerequisites

- **Node** ≥ 22.14
- **pnpm** 9.15 (pinned via `packageManager`; if not on PATH, prefix commands with
  `npx --yes pnpm@9.15.0`)
- **Docker** (for the local demo target databases)

### Setup

```sh
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # then fill in JWT_SECRET, CREDENTIAL_ENCRYPTION_KEY, admin creds

# 3. Start the local demo target databases (Postgres on :5434, MySQL on :3307).
#    The app DB is file-based SQLite (no service needed).
docker compose up -d

# 4. Apply the schema and seed the admin user
pnpm --filter @prost/api prisma:migrate
pnpm --filter @prost/api prisma:seed

# 5. Run everything (web on :5173, api on :3010)
pnpm -w dev
```

Then open <http://localhost:5173/app> and log in with the admin credentials from your `.env`
(`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Two ready-made target DBs are seeded (both `demo`/`demo`,
db `demo`) with `users`/`orders`/`products` tables: `demo-target-postgres` on port **5434** and
`demo-target-mysql` (MySQL 8.0) on port **3307** — the latter also seeds a composite-key
`order_items` table.

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

## Docker

Prost ships as a **single production image** (`thomastsoi/prost`): the NestJS API serves both
the JSON API and the pre-built React SPA on one port (`5354` by default). The app database is file-based
SQLite stored on a volume mounted at `/data`; on start the container applies Prisma migrations
and (optionally) seeds the admin user.

### Build locally

```sh
docker build -t prost:local .
```

The multi-stage build (`Dockerfile`) installs the workspace, builds the SPA (with an empty
`VITE_API_URL` so it calls the API same-origin) and the API, then extracts only the API's
production dependency closure via `pnpm deploy`. The final image runs as the non-root `node`
user.

### Run

```sh
docker run -d --name prost -p 5354:5354 \
  -v prost-data:/data \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e ADMIN_EMAIL="admin@prost.local" \
  -e ADMIN_PASSWORD="change-me" \
  thomastsoi/prost:latest
```

Then open <http://localhost:5354> and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**Running on a different port** — the image listens on `5354` by default. To publish it on
another host port just remap with `-p` (the container's internal port can stay `5354`):

```sh
docker run -d --name prost -p 8080:5354 -v prost-data:/data \
  -e JWT_SECRET="..." -e CREDENTIAL_ENCRYPTION_KEY="..." thomastsoi/prost:latest
# → http://localhost:8080
```

To also change the port the server *listens* on inside the container (e.g. for a reverse
proxy on the Docker network), set `PORT`: `-e PORT=8080 -p 8080:8080`. `PORT` flows through to
the server, the entrypoint, and the healthcheck.

> ⚠️ **Set `CREDENTIAL_ENCRYPTION_KEY` to a stable value in production.** Saved target-DB
> credentials are encrypted with it; if it changes (or the container generates an ephemeral one
> because it was left unset), previously stored credentials can no longer be decrypted. Keep the
> `/data` volume to persist users, connections, history, and snippets across restarts.

#### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | **yes** (prod) | ephemeral random | Signs auth JWTs. Rotating it invalidates issued tokens. |
| `CREDENTIAL_ENCRYPTION_KEY` | **yes** (prod) | ephemeral random | 32-byte base64 key (AES-256-GCM) for target-DB credentials at rest. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | no | — | If both set, an admin user is upserted on start. |
| `DATABASE_URL` | no | `file:/data/prost.db` | SQLite app-DB location (keep it under the `/data` volume). |
| `PORT` | no | `5354` | Port the server listens on. |
| `WEB_ORIGIN` | no | `http://localhost:5173` | Extra CORS origins (comma-separated). Not needed for the bundled same-origin SPA. |
| `QUERY_TIMEOUT_MS` | no | `30000` | Per-query timeout against target DBs. |

For a throwaway demo, `docker run -p 5354:5354 thomastsoi/prost` works without any flags — the
entrypoint generates ephemeral secrets and warns. Do not rely on that in production.

### Automated publishing (GitHub Actions)

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) builds and pushes the image to
Docker Hub on every push to `main` (and via manual **Run workflow** / `workflow_dispatch`):

1. Checks out the repo and sets up Docker Buildx.
2. Logs in to Docker Hub using the repository secrets.
3. Builds from the root `Dockerfile` (with GitHub Actions layer caching).
4. Pushes `thomastsoi/prost` tagged **`latest`**, the **full git commit SHA**, and a short
   `sha-<short>` convenience tag.

#### Configure the required secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Value |
| --- | --- |
| `DOCKERHUB_USERNAME` | Your Docker Hub username (e.g. `thomastsoi`). |
| `DOCKERHUB_TOKEN` | A Docker Hub **access token** (Account Settings → Security → New Access Token) with Read/Write/Delete on the `thomastsoi/prost` repo. Prefer a token over your password. |

The Docker Hub repository `thomastsoi/prost` must exist (or the token must be allowed to create
it) before the first push.

## Releases

Versioning is automated with [semantic-release](https://semantic-release.gitbook.io/) on
pushes to `main`, driven by [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` → minor, `fix:`/`perf:` → patch, `BREAKING CHANGE:` → major. Each release creates a
git tag and a GitHub Release (the changelog lives on the
[Releases page](https://github.com/tsoithomas/prost/releases)); CI does not commit back to the
branch. See the commit-message conventions in [`CLAUDE.md`](CLAUDE.md#commit-messages).

## License

[MIT](LICENSE) © Thomas Tsoi
