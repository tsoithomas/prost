# Prost

A self-hosted, web-based database client for PostgreSQL, MySQL 8.0+, and SQLite — connection
management, schema browsing, grid editing, and a SQL editor, in one TablePlus-style UI that
doesn't care which engine is on the other end.

> **Status:** phases 0–40 complete (MVP + three post-MVP waves). Phases 41–47 — an on-demand
> perf/index advisor, schema diff, data generation, saved dashboards, grid conflict detection, AI
> query-rewrite, and AI-assisted data editing — are planned. Full per-phase ledger:
> [`docs/plans/README.md`](docs/plans/README.md).

## Why this exists

Most database GUIs pick a lane: one is Postgres-only and deeply integrated, another supports
everything by lowest-common-denominator SQL text boxes. Prost takes a narrower bet — three
engines (PostgreSQL, MySQL 8.0+, SQLite), each reached through the *same* `DbDriver` interface, so
a feature (row filtering, DDL preview, streaming exports) is built once against the interface and
each driver either supports it natively or the UI hides it via a capability descriptor. Nothing
in a feature service ever branches on engine name.

The rest of the shape follows from being self-hosted and internal-tool-shaped rather than a
product:

- **Credentials never leave the boundary in the clear.** Target-DB passwords are encrypted at
  rest (AES-256-GCM) behind the same `PoolManager` choke point that owns every pooled connection;
  the app's own data (users, saved connections, history) lives in a separate SQLite database that
  the driver layer never touches, and vice versa — see
  [`docs/architecture-principles.md`](docs/architecture-principles.md).
- **AI is bring-your-own-endpoint, not a vendor lock-in.** Any OpenAI-compatible API — OpenAI,
  Ollama, LM Studio, OpenRouter — configured per-user, with keys encrypted the same way as
  connection credentials. Retrieval is schema-only (≤8k chars, no row data or secrets in the
  prompt), and schema-change suggestions come back as typed, re-validated DDL requests, never as
  SQL the model asks you to trust.
- **Safety rails are structural, not cosmetic.** Read-only connections are rejected at the pool
  layer before a mutating statement (or an AI schema suggestion) ever reaches the driver; every
  DDL write and row mutation is preview → confirm → execute; a self-hosted audit trail and
  active-session monitor exist because there's no vendor dashboard to check instead.

## What it does

**Connections & schema** — JWT-guarded, seeded-admin auth (no public sign-up); connection
CRUD with paste-a-URI import (`postgres://`, `mysql://`); a real schema tree (tables, views,
materialized views, sequences, functions, procedures, triggers, enums) pulled from each engine's
system catalogs; foreign-key-aware navigation (open the referenced row, show referencing rows);
a read-only ER diagram with pan/zoom.

**Grid & editing** — AG Grid on the Infinite Row Model, so 100k+ row tables stay responsive;
inline cell editing with type-aware editors, staged bulk edits with undo/redo, column pin/group;
a structured per-column `WHERE` builder compiled server-side to parameterized SQL; on-demand
column profiling (null share, distinct count, range, top-N values) bounded by engine-native
sampling; per-column data masking that redacts sensitive values in grid reads and exports
(never in raw query results — that's a display transform, not access control).

**SQL editor** — Monaco with schema-aware autocomplete and formatting; multi-statement scripts,
each with its own result panel and timing; an optional transaction wrapper that rolls back the
whole batch on any error; `EXPLAIN`/`EXPLAIN ANALYZE` with a rendered plan-visualization view;
streaming cursor-based execution for large result sets; saved snippets and full query history
(search, star, export).

**Schema management (DDL)** — create table with a column builder, alter table (add/drop/rename
columns, NOT NULL/default/type changes), create/drop index, foreign-key constraints where the
engine supports them, and native table/column comment editing — every write goes through one
preview → confirm → execute pipeline with a live SQL diff, gated by each engine's capability
descriptor (SQLite, notably, doesn't get rich `ALTER TABLE`).

**Operational safety** — per-connection read-only/environment guardrails that block mutations
at the pool layer; active-session monitoring with kill-query; a mutation/DDL audit trail with
configurable retention; SSH tunneling for connections that live behind a bastion; CSV/JSON data
export and import.

**AI** — a chat panel grounded by schema-only retrieval, with "load into editor" instead of
auto-run; typed schema-change suggestions re-validated against live metadata before they ever
reach the UI; agentic read-only query execution for multi-step questions.

**Polish** — light/dark/system theming with a user-selectable accent and no load flash; keyboard
shortcuts with a help overlay, a command palette, a focus mode; separate desktop (resizable
sidebars) and mobile (bottom-nav) shells, both audited with `axe-core` and hardened for
keyboard/screen-reader navigation.

## Architecture

Prost touches two kinds of database that the codebase is structured to never confuse (the
project's first architectural principle):

- **Application DB** — Prost's own data (users, saved connections, preferences, history,
  snippets, audit log). Reached **only** through Prisma.
- **Target DBs** — the databases users connect to. Reached **only** through the driver layer: a
  single `PoolManager` choke point resolves one `DbDriver` per `Connection.engine` (`PgDriver`,
  `MysqlDriver`, `SqliteDriver`). All SQL is parameterized; identifiers are quoted through each
  driver's `quoteIdent`; values are bound through its positional placeholder (`$n` for PG, `?` for
  MySQL/SQLite). Feature services hold no engine branches — engine-specific policy travels through
  the driver and its descriptor, not through `if (engine === 'mysql')` scattered across services.

The durable rules every change must obey live in
[`docs/architecture-principles.md`](docs/architecture-principles.md); the full spec is
[`docs/plans/prost-mvp.md`](docs/plans/prost-mvp.md).

### Supported engines

| Engine | Versions | Namespace browsed | URI scheme | TLS |
| --- | --- | --- | --- | --- |
| **PostgreSQL** | 12+ | all schemas | `postgres://`, `postgresql://` | optional |
| **MySQL** | **8.0+** (MariaDB and pre-8.0 are rejected at connect time via `SELECT VERSION()`) | the connection's own database only | `mysql://` | optional |
| **SQLite** | file or `:memory:` | `main` | — (file path, not a network URI) | — |

MySQL's lack of `RETURNING` means inserts/updates are executing methods: the driver runs the
statement on a pinned connection, then re-selects the row by primary key. An insert must supply a
complete primary key, or omit exactly one missing `AUTO_INCREMENT` component (resolved from
`LAST_INSERT_ID()`) — anything else is rejected with **HTTP 422 before any mutation runs**.

## Tech stack

| Layer | Stack |
| --- | --- |
| **Frontend** (`apps/web`) | React 19, Vite, Tailwind v4, React Router, Zustand, TanStack Query, AG Grid, Monaco |
| **Backend** (`apps/api`) | NestJS 11, Prisma (app DB), `pg` / `mysql2` / `better-sqlite3` (target DBs), JWT, class-validator |
| **Shared** (`packages/*`) | `shared-types` (cross-boundary DTOs), `ui` (tokens, primitives, grid/editor themes), `utils` (`quoteIdent`, `parseConnectionString`) |
| **Tooling** | pnpm workspaces, Turborepo, TypeScript, ESLint + Prettier, Vitest |

```
apps/
  web/                 React + Vite + TS frontend
  api/                 NestJS + TS backend (app DB only)
packages/
  shared-types/        GridResponse, StatementResult, ColumnMetadata, DTOs — imported by both apps
  ui/                  design tokens, primitives, AG Grid theme, Monaco theme
  utils/               framework-free helpers (quoteIdent, parseConnectionString)
docs/                  spec, architecture principles, per-phase plans
docker-compose.yml     demo target databases (Postgres :5434, MySQL :3307)
```

## Getting started

### Prerequisites

- **Node** ≥ 22.14
- **pnpm** 9.15 (pinned via `packageManager`; if not on `PATH`, prefix commands with
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

# 5. Run everything (web on :5173, api on :3001)
pnpm -w dev
```

Open <http://localhost:5173/app> and log in with the admin credentials from your `.env`
(`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Two ready-made target DBs are seeded (both `demo`/`demo`, db
`demo`) with `users`/`orders`/`products`: `demo-target-postgres` on **5434** and
`demo-target-mysql` (8.0) on **3307** — the latter also seeds a composite-key `order_items` table.

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

Prost ships as a single production image (`thomastsoi/prost`): the NestJS API serves both the
JSON API and the pre-built React SPA on one port (`5354` by default). The app database is
file-based SQLite on a volume mounted at `/data`; on start, the container applies Prisma
migrations and (optionally) seeds the admin user.

### Build locally

```sh
docker build -t prost:local .
```

The multi-stage `Dockerfile` installs the workspace, builds the SPA (with an empty
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

Open <http://localhost:5354> and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

For a throwaway demo, `docker run -p 5354:5354 thomastsoi/prost` works with no flags — the
entrypoint generates ephemeral secrets and warns loudly. Don't rely on that past a demo: a
rotating `CREDENTIAL_ENCRYPTION_KEY` makes previously stored connection credentials permanently
undecryptable.

**Different host port** — remap with `-p` (the container's internal port can stay `5354`):
`docker run ... -p 8080:5354 ...` → <http://localhost:8080>. To change the port the server
*listens* on inside the container (e.g. behind a reverse proxy), set `PORT` and remap both sides:
`-e PORT=8080 -p 8080:8080`.

#### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | **yes** (prod) | ephemeral random | Signs auth JWTs. Rotating it invalidates issued tokens. |
| `CREDENTIAL_ENCRYPTION_KEY` | **yes** (prod) | ephemeral random | 32-byte base64 key (AES-256-GCM) for target-DB credentials at rest. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | no | — | If both set, an admin user is upserted on start. |
| `DATABASE_URL` | no | `file:/data/prost.db` | SQLite app-DB location (keep it under the `/data` volume). |
| `PORT` | no | `5354` | Port the server listens on. |
| `WEB_ORIGIN` | no | `http://localhost:5173` | Extra CORS origins (comma-separated); not needed for the bundled same-origin SPA. |
| `QUERY_TIMEOUT_MS` | no | `30000` | Per-query timeout against target DBs. |
| `HISTORY_RETENTION_DAYS` | no | `90` | Non-starred query-history entries older than this are pruned; `0` disables the sweep. |
| `AUDIT_RETENTION_DAYS` | no | driver default | Retention for the mutation/DDL audit log. |

For anything not listed here — pool sizing, streaming/cursor limits, throttling — see
`.env.example`, which documents every variable the API reads.

### Automated publishing (GitHub Actions)

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) builds and pushes the image to
Docker Hub on every push to `main` (and via manual **Run workflow**): builds from the root
`Dockerfile` with GitHub Actions layer caching, then pushes `thomastsoi/prost` tagged `latest`,
the full commit SHA, and a `sha-<short>` convenience tag. Requires `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` (an access token, not a password) as repository secrets, and the
`thomastsoi/prost` Docker Hub repository to already exist.

## Releases

Versioning is automated with [semantic-release](https://semantic-release.gitbook.io/) on pushes
to `main`, driven by [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` → minor, `fix:`/`perf:` → patch, `BREAKING CHANGE:` → major. This is tag-only — it cuts a
git tag and GitHub Release but doesn't bump `package.json` or write a changelog; the tag itself is
the version of truth, injected into the running app's status bar at build time. See
[Releases](https://github.com/tsoithomas/prost/releases) and the commit conventions in
[`CLAUDE.md`](CLAUDE.md#commit-messages).

## License

[MIT](LICENSE) © Thomas Tsoi
