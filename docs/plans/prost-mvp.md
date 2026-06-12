# Prost MVP — Specification & Build Plan

> Self-contained spec for building Prost, a web-based PostgreSQL client (TablePlus-inspired)
> for internal developer use. This document is the source of truth for execution. It merges
> the product spec with confirmed engineering decisions so it can be built end-to-end without
> further context.

---

## 1. Overview

Prost is a web-based PostgreSQL client that provides:

- PostgreSQL connection management
- Schema browsing
- Table data viewing
- Inline row editing (spreadsheet-like)
- SQL query execution
- Query result visualization with conditional editability

It prioritizes speed, usability, and developer productivity.

### Goals — a user can:

1. Connect to a PostgreSQL database
2. Browse schemas and tables
3. View table contents
4. Edit data inline
5. Insert and delete rows
6. Execute arbitrary SQL queries
7. View query results in a data grid
8. Edit query results when safely possible

### Non-Goals (MVP)

MySQL / SQLite / MSSQL support · SSH tunneling · ER diagrams · team collaboration ·
multi-tenant SaaS · stored procedure / trigger editors · advanced RBAC · query plan
visualization · background jobs · query scheduling · AI features.

---

## 2. Confirmed Engineering Decisions

| Area | Decision |
| --- | --- |
| **App DB access** | **Prisma** (app DB only). Target DBs use the raw **`pg`** driver. |
| **Auth model** | **Seeded admin + invite.** No public self-registration. Login-only UI. |
| **Build sequencing** | **Vertical slice first**, then layer features. Reviewable checkpoints. |
| **Styling** | Tailwind CSS in `packages/ui`, driven by CSS-variable design tokens. |
| **Responsive** | Mobile (~360px) → desktop. Mobile uses a **bottom navbar + bottom-sheet menu**. |
| **Theming** | Light / dark / system color mode **and** user-selectable accent color. |
| **Credential encryption** | AES-256-GCM, master key from `CREDENTIAL_ENCRYPTION_KEY` (32-byte, base64), per-record random IV + auth tag. |
| **Query timeout** | 30s default via `statement_timeout` (`QUERY_TIMEOUT_MS=30000`). |

**Hard architectural rule:** the **Prost application DB** (users, saved connections,
preferences, query history) is completely separate from **target databases** users connect
to. The app DB is reached only through Prisma; target DBs are reached only through the raw
`pg` driver with parameterized queries.

---

## 3. Technology Stack

### Monorepo

TypeScript monorepo using **pnpm workspaces** + **Turborepo**.

```text
prost/
├── apps/
│   ├── web/                 # React + Vite + TS frontend
│   └── api/                 # NestJS + TS backend
├── packages/
│   ├── shared-types/        # GridResponse, ColumnMetadata, DTOs, enums
│   ├── ui/                  # shared React components + Tailwind preset + theme tokens
│   └── utils/               # cross-cutting helpers (sql-ident quoting, result mappers)
├── docs/
├── spec/
├── docker-compose.yml       # local Prost app Postgres (+ optional demo target DB)
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

**Tooling:** pnpm (via `corepack enable`), Turborepo pipelines (`dev`, `build`, `lint`,
`test`), TypeScript project references with path aliases (`@prost/shared-types`,
`@prost/ui`, `@prost/utils`), ESLint + Prettier, Vitest for unit tests. Node 25 and Docker
are assumed available.

### Frontend (`apps/web`)

- React + TypeScript + **Vite**
- **AG Grid Community** (data grid)
- **Monaco Editor** (SQL editor)
- **TanStack Query** (server state)
- **Zustand** (active connection, UI/session, theme)
- **React Router**
- **Tailwind CSS** (semantic CSS-variable tokens)

### Backend (`apps/api`)

- **NestJS** + TypeScript
- **`pg`** driver (target DBs only)
- **Prisma** (app DB only)
- WebSocket support (gateway scaffolded; no realtime feature in MVP)
- **class-validator** + **class-transformer**
- **bcrypt** (password hashing), **jsonwebtoken/@nestjs/jwt** (auth)
- A SQL parser (e.g. **`node-sql-parser`**) for the editability analyzer

### Databases

- **Prost Application DB** — Postgres holding users, saved connections, preferences, query history.
- **Target Databases** — the Postgres DBs users connect to and manage. Always isolated from the app DB.

---

## 4. Phased Execution (vertical slice first)

### Phase 0 — Scaffold & infra
- Init pnpm workspace; `turbo.json` pipelines; `tsconfig.base.json` with path aliases.
- `docker-compose.yml`: `prost-postgres` (app DB, non-default port) + optional
  `demo-target-postgres` seeded with sample tables for manual testing.
- `apps/api`: NestJS app + Prisma. `apps/web`: Vite React TS app + Tailwind + router shell.
- `.env.example` documenting `DATABASE_URL`, `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`,
  `QUERY_TIMEOUT_MS=30000`.

### Phase 1 — Vertical slice (first reviewable checkpoint)
Login → create/test connection → browse schema tree → view a table's first 100 rows.
- Backend: `AuthModule` (login + JWT guard, seeded admin), `ConnectionModule`
  (CRUD + test, encrypted credentials, never returns password), `MetadataModule`
  (schemas/tables/columns/PKs), `GridModule` read path (paged `SELECT`).
- Frontend: login page, top bar + sidebar + workspace layout, connection modal, schema
  tree, read-only AG Grid table view with server-side pagination.

### Phase 2 — Editing
- `GridModule` write path: cell update, insert row, delete row (parameterized, PK-based).
- Frontend: inline edit with optimistic update + revert-on-error, insert blank row,
  delete with confirmation.

### Phase 3 — SQL editor + editable results
- `QueryModule`: execute arbitrary SQL with timeout; **editability analyzer** returns
  `editable`, `sourceTable`, `primaryKey` metadata.
- Frontend: Monaco editor, Cmd/Ctrl+Enter run, results in the same grid; grid editable
  only when backend says so.

### Phase 4 — Query history
- `HistoryModule`: persist executed queries per user/connection; list recent.
- Frontend: recent-queries panel in the SQL editor; click to load.

### Phase 5 — Theming & responsiveness
Woven through every phase, hardened here: light/dark/system mode + accent color selection,
persisted preference, mobile bottom-navbar/bottom-sheet, responsive layout audit at
360/768/1280px. See §8.

---

## 5. Architecture — Frontend (`apps/web`)

### 5.1 Layout

```text
+------------------------------------------------+
| Top Bar                                        |
+------------------------------------------------+
| Sidebar | Main Workspace                       |
|         |                                      |
+------------------------------------------------+
```

- **Top Bar:** active connection selector, connection status indicator, run-query button,
  refresh button, current database display, settings menu (theme).
- **Sidebar (schema explorer):** tree of `Connection → Schema → Table`; expand/collapse
  schemas; select table; refresh schema tree.
- **Main Workspace** — three modes:
  - **Table View** — table contents in the data grid.
  - **SQL Editor** — Monaco editor.
  - **Query Results** — query execution results (same grid component).

### 5.2 State & data

- **TanStack Query** for all server state (connections, schema metadata, grid pages, history).
- **Zustand** stores: `connectionStore` (active connection), `uiStore` (workspace mode,
  selected table), `themeStore` (color mode + accent; runtime source of truth).
- **React Router** routes: `/login`, `/app` (workspace with table/query sub-views).
- JWT stored client-side and attached via a fetch/axios interceptor; `401 → redirect to /login`.

### 5.3 Data grid (AG Grid Community, shared via `packages/ui`)

- **Viewing:** server-side pagination (page size 100), sorting, filtering, refresh.
- **Editing:** single- or double-click enters edit mode; **Enter = save**, **Escape = cancel**;
  insert blank row; delete row with confirmation dialog.
- **Optimistic updates:** edit cell → UI updates immediately → API request → success keeps
  value; failure reverts value and shows an error toast.
- The grid is **editable only when `GridResponse.editable === true`**. The frontend never
  computes editability itself.

### 5.4 SQL editor (Monaco)

- SQL syntax highlighting.
- Run shortcut: **Cmd+Enter** (mac) / **Ctrl+Enter** (windows).
- Results render in the same grid component as Table View.
- Recent-queries panel sourced from query history; click a query to load it into the editor.

### 5.5 Auth UI

- Login form only (no signup). On success store JWT and route to `/app`.

---

## 6. Architecture — Backend (`apps/api`)

NestJS modules (mirrors spec, plus `PreferenceModule`):
`AuthModule`, `ConnectionModule`, `MetadataModule`, `QueryModule`, `GridModule`,
`HistoryModule`, `PreferenceModule`.

### 6.1 App DB schema (Prisma — `apps/api/prisma/schema.prisma`)

- **User** — `id`, `email` (unique), `passwordHash`, `createdAt`, `updatedAt`.
- **Connection** — `id`, `userId`, `name`, `host`, `port`, `database`, `username`,
  `encryptedCredentials` (ciphertext + iv + tag), `sslEnabled`, `createdAt`, `updatedAt`.
  **No plaintext password column.**
- **QueryHistory** — `id`, `userId`, `connectionId`, `sql`, `executedAt`.
- **UserPreference** — `userId` (unique), `colorMode` (`light`|`dark`|`system`),
  `accentColor` (hex/token), with room for future preferences.

A seed script creates the initial admin user from env vars (e.g. `ADMIN_EMAIL`,
`ADMIN_PASSWORD`). No public registration endpoint.

### 6.2 Target-DB access — `PgConnectionService`

- Caches a `pg.Pool` per saved connection (keyed by `connectionId`), lazily created from
  decrypted credentials. Sets `statement_timeout` from `QUERY_TIMEOUT_MS`.
- **All** target queries funnel through one `runParameterized(sql, params)` helper — the
  only code that talks to target DBs.
- **Never** build SQL via string concatenation. Identifiers (schema/table/column names) are
  quoted via a `quoteIdent` util in `packages/utils`; values are always bound as `$n` params.

### 6.3 Credential encryption — `CryptoService`

- AES-256-GCM, key from `CREDENTIAL_ENCRYPTION_KEY`. `encrypt()` → `{ iv, tag, data }`;
  `decrypt()` reverses it.
- Passwords are decrypted only in-memory to build a pool; never serialized to any DTO.
- Connection responses use a `ConnectionDto` that omits all credentials. **Passwords are
  never returned to the frontend after creation.**

### 6.4 Metadata service (`MetadataModule`)

Uses PostgreSQL system catalogs and `information_schema`:

- **Schemas:** `information_schema.schemata` (exclude system schemas like `pg_catalog`, `information_schema`).
- **Tables:** `information_schema.tables`.
- **Columns:** `information_schema.columns` → name, data type, nullable.
- **Primary keys:** `pg_index` / `pg_attribute` (or `information_schema` key/constraint views).
- Returns `SchemaMetadata` / `TableMetadata` / `ColumnMetadata` from `@prost/shared-types`.

Table metadata exposed: column name, data type, nullable, primary-key flag.

### 6.5 Grid read path (`GridModule`)

- On table selection: `SELECT * FROM <schema>.<table> ORDER BY <pk?> LIMIT $1 OFFSET $2`
  (default limit 100, offset 0).
- Sorting/filtering applied server-side via whitelisted column names + bound params.
- Returns `GridResponse { rows, columns, editable, sourceTable, primaryKey, totalRows? }`.
- Never loads entire tables; server-side pagination only. Supports tables of 100,000+ rows.

### 6.6 Grid write path (parameterized, PK-keyed)

- **Update** (request shape below):
  ```sql
  UPDATE <table> SET <column> = $1 WHERE <pk> = $2;
  ```
  Request:
  ```json
  {
    "connectionId": "...",
    "table": "users",
    "primaryKey": { "id": 123 },
    "column": "name",
    "value": "Thomas"
  }
  ```
- **Insert:** `INSERT INTO <table> (...) VALUES (...) RETURNING *;` — frontend opens a blank row.
- **Delete:** `DELETE FROM <table> WHERE <pk> = $1;` — requires client-side confirmation.

All parameterized; identifiers quoted, values bound.

### 6.7 Query execution + editability analyzer (`QueryModule`)

Executes arbitrary SQL (e.g. `SELECT`, `UPDATE`, `DELETE`) with the query timeout. Surfaces
SQL errors, connection errors, and timeout errors distinctly.

The backend determines result editability (the frontend must not duplicate this logic).
Parse the SQL with a SQL parser and mark **editable only when all hold:**

- the statement is a single `SELECT`,
- it references exactly one table,
- there are **no joins**,
- there are **no aggregates / `GROUP BY` / `DISTINCT`**,
- the table's primary-key column(s) are present in the projection.

Otherwise the result is **read-only**.

**Editable examples:** `SELECT * FROM users;` · `SELECT id, name, email FROM users;`
**Read-only examples:** `SELECT COUNT(*) FROM users;` · `SELECT * FROM users JOIN orders ON orders.user_id = users.id;` · `SELECT department, COUNT(*) FROM users GROUP BY department;`

Response metadata shape:
```json
{
  "rows": [],
  "columns": [],
  "editable": true,
  "sourceTable": "users",
  "primaryKey": ["id"]
}
```
The frontend trusts this verbatim.

### 6.8 Query history (`HistoryModule`)

Persists executed queries (`id`, `userId`, `connectionId`, `sql`, `executedAt`); exposes a
"recent queries" list scoped to the user/connection for the SQL editor.

### 6.9 Security

- JWT authentication guard on all data routes.
- bcrypt password hashing.
- AES-256-GCM credential encryption at rest.
- Parameterized SQL only (no string concatenation).
- 30s query timeout via `statement_timeout`.
- class-validator / class-transformer on all DTOs.

---

## 7. Shared Types (`packages/shared-types`)

Single source of truth imported by both apps:
`GridResponse`, `ColumnMetadata`, `TableMetadata`, `SchemaMetadata`,
`ConnectionDto` (no credentials), `CreateConnectionDto`, `QueryResult`,
`RowUpdateRequest`, `RowInsertRequest`, `RowDeleteRequest`, `UserDto`,
`QueryHistoryDto`, `UserPreferenceDto` (`colorMode`, `accentColor`).

Connection fields (input): `name`, `host`, `port`, `database`, `username`, `password`
(input only), `sslEnabled`. `ConnectionDto` omits `password`.

---

## 8. Theming & Responsiveness

### 8.1 Design tokens

- Semantic CSS variables drive Tailwind: `--color-bg`, `--color-surface`, `--color-text`,
  `--color-border`, `--color-accent`, etc. Light and dark token sets are defined once in
  `packages/ui` (`theme/tokens.css`).
- Components reference semantic tokens only — never hardcoded colors — so theme + mode
  switch with zero component changes. AG Grid and Monaco are themed from the same tokens.

### 8.2 Color mode

- Light / dark / **system** (`system` follows `prefers-color-scheme`).
- Applied by toggling a `data-theme` / class on `<html>`.
- **No flash on load:** an inline pre-hydration script in `index.html` reads the persisted
  choice before first paint.

### 8.3 Accent color

- User picks from a small preset palette and/or a custom hex value.
- Stored as `--color-accent` with derived shades; applied to buttons, active states, links,
  focus rings.

### 8.4 Persistence

- Preferences saved to `UserPreference` (server) and mirrored to `localStorage` for instant
  first paint. Zustand `themeStore` is the runtime source of truth.
- A Settings panel/menu in the top bar chooses mode + accent with live preview.

### 8.5 Responsive layout (mobile → desktop)

- **Desktop (`≥ md`):** persistent top bar + sidebar + workspace side-by-side (the §5.1
  layout). **No bottom navbar.**
- **Mobile (`< md`):** a **fixed bottom navbar replaces the side drawer entirely.** It holds
  only a few essential buttons (e.g. Connections/Schema, Table, SQL editor, Run) plus a
  burger icon. There is **no** top-bar burger and **no** side drawer on mobile.
- **Burger → bottom sheet:** tapping the burger opens an extended vertical menu that slides
  **up from the bottom** (a bottom sheet) with the full set of actions/destinations: schema
  tree, connection switcher, settings/theme, query history, sign out. Dismiss via swipe-down
  or tapping the scrim.
- Workspace goes full-width; content sits above the bottom navbar (safe-area-inset aware).
- **Data grid** on small screens: horizontal scroll with sticky first column / header;
  touch-friendly hit targets; pagination controls remain reachable above the navbar.
- **Monaco** on mobile: full-width, height-capped, with the results grid stacked below.
- All tap targets ≥ 44px; modals become full-screen sheets on mobile.
- Verified at 360 / 768 / 1280px breakpoints.

---

## 9. Performance Requirements

- Tables up to 100,000+ rows.
- Default page size 100; never load entire tables; server-side pagination only.
- Total-row counts for huge tables use an approximate count (`pg_class.reltuples`) to avoid
  full scans; exact count optional and off by default.

---

## 10. Files to Create (critical paths)

- Root: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `docker-compose.yml`, `.env.example`, `package.json`
- `apps/api/prisma/schema.prisma` (incl. `UserPreference`) + seed script (admin user)
- `apps/api/src/{auth,connection,metadata,query,grid,history,preference}/*` modules
- `apps/api/src/common/{crypto.service.ts, pg-connection.service.ts}`
- `packages/shared-types/src/index.ts`
- `packages/utils/src/quote-ident.ts`
- `packages/ui/src/grid/DataGrid.tsx`, `packages/ui/src/theme/tokens.css`, Tailwind preset
- `apps/web/src/{layout,sidebar,topbar,table-view,sql-editor,auth,settings}/*`
- `apps/web/src/navigation/{BottomNavBar.tsx, BottomSheetMenu.tsx}` (mobile nav)
- `apps/web/src/stores/themeStore.ts` + pre-hydration theme script in `index.html`

---

## 11. Verification

### Infra / unit (each phase)
- `docker compose up -d` brings up the app Postgres; `pnpm prisma migrate dev` applies the
  schema; seed creates the admin user.
- `pnpm -w build` and `pnpm -w lint` pass across all packages.
- Vitest unit tests: `CryptoService` encrypt/decrypt round-trip; `quoteIdent`; editability
  analyzer truth table (single-table SELECT = editable; join/aggregate/COUNT = read-only);
  grid SQL builders produce parameterized statements (assert no interpolated values).

### End-to-end (manual, against the demo target DB)
1. Log in as the seeded admin.
2. Create a connection to the demo target DB; **Test connection** succeeds; reload and
   confirm the password is never present in any API response.
3. Browse schema tree; expand a schema; select a table → first 100 rows load; paginate.
4. Inline-edit a cell → value persists; force a failure (e.g. NOT NULL) → value reverts + error shown.
5. Insert a row; delete a row (confirm dialog) → grid reflects changes.
6. Run `SELECT * FROM users` → grid editable. Run `SELECT COUNT(*) FROM users` and a
   JOIN/GROUP BY query → grid read-only.
7. Re-open SQL editor → recent queries listed; click reloads one.
8. **Theming:** toggle light/dark/system and change accent color in Settings → UI (incl.
   grid + Monaco) updates live; reload preserves choice with no flash; verify it round-trips
   through `UserPreference` on the server.
9. **Responsive:** at 360 / 768 / 1280px — on mobile a fixed bottom navbar (essential buttons
   + burger) replaces the side drawer; the burger opens a bottom-sheet vertical menu that
   slides up from the bottom; grid scrolls horizontally with sticky header; modals become
   full-screen sheets; all controls stay reachable. Desktop keeps the side-by-side sidebar
   layout with no bottom navbar.

---

## 12. MVP Completion Criteria

MVP is complete when a user can:

1. Log in
2. Create a PostgreSQL connection
3. Browse schemas
4. Browse tables
5. View rows
6. Edit rows inline
7. Insert rows
8. Delete rows
9. Execute SQL queries
10. View query results
11. Edit query results when eligible
12. View query history

…and theming (light/dark/system + accent) and the responsive mobile experience
(bottom navbar + bottom-sheet menu) verify per §11 steps 8–9.

At that point Prost is a usable internal PostgreSQL client MVP.