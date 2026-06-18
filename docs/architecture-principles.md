# Prost — Architecture & Design Principles

> These are the durable, non-negotiable principles for Prost. Every change — feature,
> refactor, or fix — must obey them. When a principle and a convenience conflict, the
> principle wins. If a principle genuinely needs to change, change it here first, in a
> dedicated PR, with rationale.

---

## 1. The two-database boundary is sacred

Prost touches two kinds of database, and they must never be confused.

- **Application DB** — Prost's own data: users, saved connections, preferences, query
  history. Accessed **only** through Prisma.
- **Target DBs** — the databases users connect to and manage (PostgreSQL, MySQL 8.0+, or
  SQLite). Accessed **only** through the engine-neutral driver layer (`PoolManager` → a
  `DbDriver` resolved per `Connection.engine`: `PgDriver`, `MysqlDriver`, `SqliteDriver`),
  never through Prisma. Engine-specific behavior (placeholders, namespace model, insert-key
  derivation, supported DDL) lives entirely behind the driver and its descriptor — **feature
  services contain no `engine === '…'` branches**, and the frontend consumes the descriptor
  rather than duplicating engine policy.

**Rules**
- Prisma never opens a target DB. A `DbDriver` never opens the app DB through the app's Prisma
  client.
- No target-DB credential, schema, or row ever lands in an app-DB table (history stores
  SQL text and identifiers only — never result data or credentials).
- All target-DB access flows through **one** choke point (`PoolManager.run` /
  `withTransaction`). If you find yourself opening a native client (`pg.Pool`, a
  `better-sqlite3` `Database`, …) outside a driver, stop.

**Sanctioned exception — inspecting the app DB.** A SQLite *target* connection may point at the
application's own database file purely for read/inspection (so Prost can browse its own data).
This still flows entirely through the target-DB seam (`PoolManager` → `SqliteDriver`) — it never
borrows the app's Prisma client, and it never writes target data back into an app-DB table. The
boundary (two code paths, never crossed) holds; only the physical file is shared.

## 2. All target SQL is parameterized — no unsafe interpolation

The rule is about **intent, not dogma**: no untrusted input ever reaches SQL as raw string.
Dynamic SQL is allowed — it must pass through an approved builder or validator, never through
naive concatenation.

- Values are **always** bound as parameters through the driver's positional placeholder
  (`$n` for PostgreSQL, `?` for MySQL/SQLite). Never interpolate a value into SQL.
- Identifiers (schema/table/column names) come from server-side metadata and are passed
  through the `quoteIdent` util — never concatenated raw, never taken on trust from the client.
- Legitimate dynamic constructs (e.g. a chosen `ORDER BY` column) are valid **only** when the
  dynamic part is constrained to a server-known set and quoted/validated by an approved util.
  "I needed it dynamic" is never a license to interpolate.
- There is no code path that builds target SQL by string concatenation of user input.
  Treat every such construction as a security bug.

## 3. Security is enforced on the server, never assumed on the client

- **Credentials are encrypted at rest** (AES-256-GCM) and decrypted only in memory to open a
  pool. A target-DB password is **never** serialized into any DTO or returned to the client
  after creation. DTOs omit secrets by construction, not by hoping the caller filters them.
- **AuthN/AuthZ live on the backend.** Every data route is guarded (JWT). The frontend may
  hide UI, but the server must independently reject unauthorized requests.
- **Queries are bounded.** Every target query runs under a statement timeout, applied by the
  driver in the engine's idiom (PostgreSQL `statement_timeout`, the `mysql2` per-query
  `timeout`, …). No unbounded execution.
- Secrets come from environment/config (`CREDENTIAL_ENCRYPTION_KEY`, `JWT_SECRET`, DB URLs) —
  never hardcoded, never committed.

## 4. The backend decides; the frontend renders

The client is a presentation layer. Business rules that affect correctness or safety are
computed server-side and shipped as metadata.

- **Editability is the canonical example:** the backend determines whether a result set is
  editable (single table, no joins/aggregates, PK present) and returns
  `{ editable, sourceTable, primaryKey }`. The frontend trusts this verbatim and **never**
  re-derives it.
- New rules of this kind (what's writable, what's safe, what a row's identity is) belong on
  the server and travel as data, not as duplicated client logic.
- **Purely cosmetic** decisions (formatting, local sort of an already-loaded page, optimistic
  UI state) may live on the client. The line is correctness/safety vs. presentation — the
  client is never the source of truth for the former.
- **Server-issued metadata is untrusted once it leaves the server.** When the client sends it
  back on a mutation (`sourceTable`, `primaryKey`, `editable`), the server **re-validates**
  against live schema before acting — it never trusts the echoed values. This closes
  stale/forged-metadata bugs: a metadata snapshot is a hint to the UI, not an authorization.

## 5. One grid contract, one grid component

- Table views and query results use the **same** `GridResponse` shape and the **same** grid
  component. Don't fork a second result format or a second grid.
- `GridResponse` (rows, columns, editable, sourceTable, primaryKey, optional totals) is the
  single contract between any data-producing endpoint and the UI.
- **Evolve it by adding optional fields, not by forking or bloating.** If a future view (e.g.
  heavy analytics) genuinely can't fit, introduce a *narrower* sibling that the same grid can
  render — don't let `GridResponse` accrete mode-specific flags until it's a god schema. The
  default remains one shape; specialization is the exception you justify, per §13.

## 6. Shared types are the single source of truth

- Cross-boundary shapes (DTOs, `GridResponse`, metadata, requests) live in
  `@prost/shared-types` and are imported by **both** apps. Don't hand-redeclare a type on one
  side to "match" the other.
- If a contract changes, change it in `shared-types` and let both ends fail to compile.

## 7. Never load more than a page

- All large reads are **server-side paginated** (default 100 rows). The app must remain
  responsive on tables of 100,000+ rows.
- No "fetch everything then filter/sort in the browser." Sorting, filtering, and paging
  happen in SQL with bound params.
- Expensive operations (e.g. exact full-table counts) are approximated or opt-in, never the
  default path.

## 8. Mutations are safe and reversible-feeling

- Inline edits use **optimistic updates with rollback**: apply immediately, send the request,
  keep on success, revert + surface the error on failure. The UI never silently diverges from
  the database.
- Destructive actions (delete) require explicit confirmation and are keyed by primary key.
- Every write identifies its target row by primary key — if a result has no usable PK, it is
  not editable (see §4).

## 9. Theming and responsiveness are structural, not bolted on

- **Color is a token, never a literal.** Components reference semantic CSS variables
  (`--color-bg`, `--color-text`, `--color-accent`, …). No hardcoded hex in components. Light,
  dark, and accent variants switch by swapping tokens — including AG Grid and Monaco.
- **Every screen works from ~360px to desktop.** New UI must be designed mobile-first and
  honor the platform's navigation model (desktop: sidebar; mobile: bottom navbar + bottom
  sheet) rather than inventing a parallel one.
- User preferences (mode, accent) persist server-side and render without flash on load.

## 10. Modules are cohesive and bounded

- Backend features are NestJS modules with a clear responsibility (`Auth`, `Connection`,
  `Metadata`, `Query`, `Grid`, `History`, `Preference`). New capability → new or existing
  module, not a grab-bag service.
- Cross-cutting, dependency-free logic (identifier quoting, result mapping, crypto helpers)
  lives in `packages/utils` / `common`, not duplicated per feature.
- Keep the dependency direction clean: shared packages don't import app code.

## 11. Errors are specific and honest

- Distinguish and surface error classes: SQL errors, connection errors, timeout errors,
  auth errors. Don't collapse them into a generic failure.
- Never leak secrets or raw stack traces to the client; log detail server-side, return a
  safe, actionable message.

## 12. Operations are observable

A DB-heavy product is debugged through its telemetry, so observability is structural, not an
add-on.

- **Logs are structured** (JSON or key-value), not bare strings. A request log carries at
  minimum: route, target-connection id (never credentials), outcome, and duration.
- **Every request carries a correlation id**, generated at the edge and threaded through the
  query path, so a client error maps to exactly one server trace. It appears in the safe
  client error envelope (see §11) for support.
- **Target queries are timed.** Capture execution duration and whether `statement_timeout`
  fired; surface timing in metadata where the UI needs it. SQL text may be logged; **bound
  values and result rows are not** (consistent with §1 and §3).
- Keep it proportionate to MVP: this is structured logging + a correlation id + query timing,
  not a full metrics/tracing platform.

## 13. Stay inside MVP scope

- Supported target engines are PostgreSQL, MySQL 8.0+, and SQLite — added through the driver
  seam, not by branching feature code. Out of scope until explicitly revisited: other engines
  (e.g. MariaDB, SQL Server, Oracle), SSH tunneling, ER diagrams, team/multi-tenant features,
  stored-procedure/trigger editors, advanced RBAC, background jobs, scheduling.
- **AI features are no longer blanket out-of-scope** — they're tracked for upcoming
  development in [`docs/future-features.md`](./future-features.md) (e.g. a schema-aware
  chat/RAG assistant). They remain subject to every other principle: no path to a target DB
  outside the `PoolManager`/driver seam (§1), no credentials/row data/bound values sent to an
  external model (§3), and any model-facing context is built from the same server-validated
  metadata the rest of the app uses (§4).
- Build the smallest thing that satisfies the principle. Add abstraction when a second real
  caller appears, not in anticipation.
- **Scope-freeze guards product surface, not internal health.** Cross-cutting refactors that
  reduce risk or complexity — and add no user-facing capability — are allowed and encouraged,
  even when discovered mid-implementation. "It looks like a new feature" is judged by whether
  it expands what the product *does*, not by how large the diff is.

---

### How to use this document

- Read it before designing a feature; cite the relevant principle in PR descriptions when a
  decision is non-obvious.
- A change that violates a principle is not "done" — it's a defect, even if it works.
- The full product/engineering detail lives in [`spec/prost-mvp.md`](../spec/prost-mvp.md);
  this file is the why and the rules, that file is the what and the how.