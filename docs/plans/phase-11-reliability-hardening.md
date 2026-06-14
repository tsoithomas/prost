# Prost — Phase 11: Reliability & Abuse Hardening

## Context

Phases 0–10 shipped the full feature set, and a focused backend hardening pass already landed
(`bd65061 fix(api): harden pooling, SSL, paging, CORS, and DDL validation per review`). A
2026-06-14 review of the shipped code surfaced four remaining soft spots in **already-built**
features — none are new functionality, all are "make the thing we built hold up under load and
abuse". This phase closes them as one reliability slice before new features pile on top.

This is the first of two "strengthening" phases (the other is Phase 12, frontend tests). It is
backend-only, independent of everything else, and should land first because the statement
invariant it pins down (§4 below) is load-bearing for Phases 16 and 22.

## Decisions (to confirm before building)

1. **Rate limiting via `@nestjs/throttler`, applied narrowly.** Add the throttler module with a
   sane global default, but the two endpoints that actually need it are:
   - `POST /auth/login` — a strict short-window limit (e.g. ~5/min per IP) to blunt brute-force,
     returning `429` with a safe message (principle §11), not a lockout.
   - `POST :id/ai/chat` — a **per-user** limit (not per-IP), because each call has real external
     cost (principle §13 "keep it proportionate"). A small per-minute cap plus a clear `429`.
   Read-only browse/query endpoints get only the lenient global default. Limits are config-driven
   (env), not hardcoded magic numbers, so deployments can tune them.
2. **Target-DB pools get a lifecycle, not just creation/eviction.** `PgConnectionService.pools`
   currently lives forever per `connectionId` until an explicit `evictPool`. Add: an **idle
   sweep** (close + drop pools unused for N minutes) and/or an **LRU cap** on the number of live
   pools, plus make `MAX_POOL_SIZE` and the idle TTL **config-driven** (matching how
   `QUERY_TIMEOUT_MS` already is). Eviction must close the `pg.Pool` cleanly and stay correct
   under the existing in-flight `Promise<Pool>` caching.
3. **The editability analyzer fails safe, provably.** `query/editability.ts` must treat "cannot
   confidently prove this maps to one updatable base table" as **read-only** — never default to
   editable on a parse it doesn't fully understand (principle §4: the backend decides). This is a
   security/data-integrity property, so it's encoded as tests, not just intent.
4. **Single statement per execution is an explicit, tested invariant.** The query path already
   assumes one statement; today that's implicit. Make it explicit: reject multi-statement input
   at the `QueryModule` boundary with a specific `400` (principle §11) until Phase 16 lifts it
   deliberately. Document the invariant in code and in `architecture-principles.md` so Phase 16
   removes a *known* guard rather than discovering an assumption.
5. **No behaviour change for the happy path.** A normal login, a normal single-statement query,
   and a normal AI chat must behave exactly as before — this phase only adds limits and lifecycle,
   observable via logs/metrics (principle §12), not user-visible workflow changes.

## Backend (`apps/api`)

### Throttling
- Add `@nestjs/throttler`; register `ThrottlerModule` in `AppModule` with a lenient global guard.
- `@Throttle` overrides on `AuthController.login` (per-IP) and `AiController.chat` (per-user — a
  custom `ThrottlerGuard`/key resolver keyed on the JWT `sub`, since AI cost is per-user).
- Ensure `429`s flow through `all-exceptions.filter.ts` with the correlation id (principle §11),
  and are logged (principle §12).

### Pool lifecycle (`target-db/pg-connection.service.ts`)
- Track `lastUsedAt` per cached pool; add an interval sweep (`OnModuleInit`/`OnModuleDestroy` to
  start/stop it) that evicts pools idle beyond `TARGET_POOL_IDLE_MS`.
- Optional LRU cap `TARGET_POOL_MAX` (evict least-recently-used when exceeded).
- Promote `MAX_POOL_SIZE` → config `TARGET_POOL_SIZE`. `onModuleDestroy` closes all pools.

### Editability fail-safe (`query/editability.ts`)
- Audit every branch: the default/unknown path returns `editable: false`. Add the cases the
  review flagged as risky (CTEs, schema-qualified names, quoted identifiers, joins, set ops,
  functions) as explicitly non-editable unless they reduce to a single updatable base table.

### Statement-count guard (`query/query.service.ts` or DTO)
- Reject input parsing to >1 top-level statement with a `400` ("Run one statement at a time").
  Keep the check in one place so Phase 16 can replace it.

### Tests (Vitest, `apps/api`)
- `throttler`: login over the limit → `429`; AI chat over the per-user limit → `429`; a second
  user is unaffected (per-user keying works).
- `pg-connection.service.test.ts` (new): idle sweep evicts and closes a stale pool; LRU cap holds;
  `onModuleDestroy` closes all; config values are honoured.
- `editability.test.ts`: extend with the risky shapes above — each asserts `editable: false`;
  the known single-updatable-table cases stay `true` (no regression).
- `query.service.test.ts`: multi-statement input → `400`; single statement unaffected.

## Frontend (`apps/web`)

Minimal — surface the new errors honestly:
- `429` on login → an inline "too many attempts, try again shortly" message (not a generic error).
- `429` / multi-statement `400` in the SQL editor → the existing error surface with the
  correlation id. No new screens.

## Verification

### Unit (Vitest, `apps/api`)
All new/extended tests above green; `pnpm -w test` passes.

### Manual
1. Hammer `/auth/login` with bad creds → `429` after the limit, recovers after the window; a valid
   login within limits still works.
2. Send AI chats past the per-user cap → `429`; a different user still chats. (Skip if no
   `LlmEndpoint` configured — exercise via a mocked endpoint.)
3. Open a connection, run queries, leave it idle past `TARGET_POOL_IDLE_MS` → logs show the pool
   evicted/closed; the next query transparently re-creates it.
4. Paste `SELECT 1; SELECT 2;` into the editor → specific `400`, nothing executed.
5. Run a join/CTE query → results render **read-only** (no accidental editable grid).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Multi-statement / transaction execution — **Phase 16** lifts the §4 guard deliberately.
- Streaming/cursor results for large sets — **Phase 22**.
- Distributed rate limiting (Redis-backed) or a full API gateway — the in-memory throttler is
  sufficient for internal-tool scale; revisit if Prost is ever multi-instance.
- Per-user AI cost dashboards / usage metering beyond the rate cap (was already out of scope in
  Phase 10).
