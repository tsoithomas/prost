# Prost — Phase 1: Vertical Slice (retrospective)

> **Status: ✅ Complete** (commit `74f6658`, "feat(phase1): wire auth, connections, schema
> browser, and table grid to a real backend"). This is a retrospective record of what shipped,
> written after the fact for documentation — not a forward plan. It reflects the repo as built.

## Context

Phase 1 is the first reviewable checkpoint: it turns the static Phase 0 shell into a working
app along one end-to-end path — **log in → create/test a real connection → browse the real
schema tree → view a table's first 100 rows (paginated)** — by replacing the frontend mocks
with a real NestJS backend, **without restyling**.

All work obeys [`../architecture-principles.md`](../architecture-principles.md): the
two-database boundary (§1), parameterized SQL + `quoteIdent` (§2), server-decides-editability
(§4), one `GridResponse` contract (§5), shared types as source of truth (§6), never load more
than a page (§7), specific/honest errors (§11), and a correlation id + structured logs (§12).

## What shipped

### Backend (`apps/api`)

**Foundation**
- **`PrismaModule` + `PrismaService`** (`prisma/`) — global, wraps `PrismaClient`; initial
  migration generated from the Phase 0 schema.
- **`CommonModule`** promotes `CryptoService` to a global provider; also hosts the
  **correlation-id middleware** (`common/correlation-id.middleware.ts`) and **global exception
  filter** (`common/all-exceptions.filter.ts`) mapping errors to the safe envelope
  `{ error, message, correlationId }` (principles §11, §12).
- **Auth primitives** (`auth/`): `@Public()` decorator + global `JwtAuthGuard` (registered via
  `APP_GUARD`, exempts login + `/health`), `@CurrentUser()` param decorator.
- **`PgConnectionService`** (`target-db/pg-connection.service.ts`) — **the single choke point
  to target DBs** (principle §1): one cached `pg.Pool` per `connectionId` (built from the
  Prisma row + `CryptoService` decrypt; `statement_timeout` from `QUERY_TIMEOUT_MS`),
  `runParameterized(connectionId, sql, params)` as the only target-SQL executor (logs
  connection id / duration / outcome, never values or rows), and `testConnection(params)` for
  throwaway-client connectivity checks.

**Feature modules**
- **`AuthModule`** — `POST /auth/login` (`@Public`, bcrypt-compare → `{ token, user }`),
  `GET /auth/me`. `LoginDto` validated with class-validator. Unit-tested guard
  (`jwt-auth.guard.test.ts`).
- **`ConnectionModule`** — full CRUD + test under `/connections`, scoped to
  `@CurrentUser().userId`: list, create (encrypts password into `encryptedCredentials`), PATCH
  (re-encrypts only if a new password is supplied), DELETE (204 + evicts cached pool), and
  `POST /connections/test`. **`ConnectionDto` never includes the password** — enforced by the
  mapper and covered by `connections.service.test.ts` (principle §3).
- **`MetadataModule`** — `GET /connections/:id/metadata` → `SchemaMetadata[]` (schemas with
  their tables), querying `information_schema`/`pg_catalog`, excluding system schemas.
- **`GridModule`** (read path) — `GET /connections/:id/tables/:schema/:table/rows`
  `?limit=100&offset=0&sortBy=&sortDir=`: resolves columns + PK, builds
  `SELECT * FROM <qSchema>.<qTable> [ORDER BY <qCol> <dir>] LIMIT $1 OFFSET $2` with
  `quoteIdent` on every identifier and `sortBy` validated against the live column set
  (principle §2), returns the full `GridResponse` with **server-computed `editable`** (single
  table + PK → true) and `pg_class.reltuples`-based approximate `totalRows` (principle §9).
  Covered by `grid.service.test.ts` (asserts identifiers quoted, values bound, no interpolation).

### Frontend (`apps/web`)

**Data layer**
- **`lib/apiClient.ts`** — `apiFetch<T>()` wrapper: base URL from `VITE_API_URL`, injects
  `Authorization: Bearer`, parses the error envelope into a typed `ApiError`
  (`status`/`code`/`message`/`correlationId`), and on **401 clears auth + redirects to
  `/login`** (spec §5.2).
- **Stores**: `authStore` (token + user, persisted), `connectionStore` (active connection id,
  persisted), `workspaceStore` (open tabs / active tab, **not** persisted) as the connective
  tissue between Sidebar/MobileExplorer table selection and the Workspace grid.
- **TanStack Query** wired in `main.tsx`; hooks in `api/` (`useLogin`, `useMe`,
  `useConnections`/`useActiveConnection`, create/update/delete/test mutations, `useMetadata`).

**Wiring (mocks → real, shell unchanged)**
- **`RequireAuth`** guards `/app/*` (validates via `useMe`, 401 → `/login`); **`LoginPage`**
  uses `useLogin` and routes to `/app` on success.
- **`ConnectionModal`** — real CRUD + test + activate (`connectionStore.setActive`); mock
  connections dropped.
- **`SchemaTree`** in the desktop `Sidebar` and `MobileExplorerView` — sourced from
  `useMetadata(activeConnectionId)` with loading/empty/error states; mock schema dropped.
- **`TableView`** — AG Grid **Infinite Row Model** datasource: `getRows({ startRow, endRow })`
  → `limit`/`offset` fetch, `cacheBlockSize=100`, end-of-data via
  `rows.length < limit` (independent of the approximate `totalRows`); column defs from the
  first block's `GridResponse.columns` (PK icons). Edit toolbar present but **inert** (Phase 2).
  Mock users grid dropped.
- **Active-connection display** across the shell (Sidebar header, `MobileTopBar`, `StatusBar`,
  Workspace breadcrumbs, mobile explorer header) reads the active connection via
  `useActiveConnection()` instead of hardcoded `PostgreSQL / localhost:5432` strings.
- The **SQL Editor tab** keeps its mock result (`mocks/orderResults.ts`) — Phase 3 owns it.

### Env / infra
- Vite reads `VITE_API_URL` from the monorepo-root `.env` (via `envDir` in `vite.config.ts`,
  mirroring the API's `envFilePath`), with a `http://localhost:3001` fallback in `apiClient`.

## Outcome (verification that passed)

- `pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all green (17 backend unit tests across
  guard, grid SQL builder, connection mapper, crypto; 9 `quoteIdent` tests).
- Manual E2E against the demo target DB (port 5434): login as seeded admin → `/auth/me` →
  list connections (**no password** in any response) → test connection (success + wrong-password
  error distinct) → metadata returns `public.users/orders/products` → paginated rows with
  correct columns, PK detection, and `totalRows` → auth error envelopes for missing/invalid
  tokens. Headless-browser check confirms unauthenticated `/app` redirects to `/login`.

## Notes / deviations from spec

- Routes use composite `:schema/:table` path params and the Infinite Row Model (rather than
  classic pagination controls) for the grid — both consistent with principle §7 (one page in
  flight) and chosen as the reusable pattern for Phase 3 query results.
- Sort UI in the grid header was deliberately **not** added: the backend supports
  `sortBy`/`sortDir` and is tested, but click-to-sort in the column header is a later
  enhancement, out of Phase 1's slice.
- Dead Phase 0 mocks (`connections.ts`, `schema.ts`, `users.ts`) were deleted once unused;
  `orderResults.ts` intentionally remains for the still-mocked SQL Editor tab.
