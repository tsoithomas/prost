# Prost — Phase 29: Active-Session Monitoring & Kill-Query

## Context

When a target database is slow or locked, the first DBA question is "what's running right now?" —
and the second is "can I kill that runaway query?" Prost has no window into the target's live
activity. This phase adds a read-only **active-session monitor** (running queries, their state,
duration, waits, blocking) and a **guarded cancel/kill** action.

It is a capability-gated ops feature behind the driver seam (principle §1): PostgreSQL exposes
`pg_stat_activity` + `pg_cancel_backend`/`pg_terminate_backend`; MySQL exposes `SHOW PROCESSLIST` +
`KILL`; SQLite has no server sessions, so the capability is simply off. It depends on nothing.

Roadmap item: Phase 29 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **Session listing + kill are capability-gated driver builders (principles §1, §13).** Add
   `supportsSessionMonitoring` to `DbCapabilities`; drivers that advertise it implement
   `buildListSessions()` and `buildKillSession(id, mode)`. SQLite advertises `false` and the UI hides
   the feature — no engine branch in feature code.
2. **One session shape in `@prost/shared-types` (principle §6):**
   ```ts
   export interface DbSession {
     id: string | number;      // pid / process id
     user?: string; database?: string; clientAddr?: string;
     state?: string;           // active | idle | idle in transaction | …
     query?: string;           // current/last statement text (no bound values)
     durationMs?: number; waitEvent?: string; blockedBy?: (string | number)[];
   }
   ```
   Query **text** is shown (like history), but never result rows or bound values (principles §1, §12).
3. **Kill is a guarded, PK-keyed destructive action (principle §8).** Cancelling (graceful) vs.
   terminating (force) map to the engine's two verbs (`pg_cancel_backend` vs.
   `pg_terminate_backend`; MySQL `KILL QUERY` vs. `KILL CONNECTION`). Both go behind `useConfirm` with
   the target session identified, and the parameter (pid) is **bound**, never interpolated
   (principle §2).
4. **Read on demand, not a firehose (principle §7).** The monitor fetches the current snapshot on
   open and on explicit refresh (optionally a bounded auto-refresh interval the user enables); it is
   not a streaming subscription. The list is inherently small (active sessions), so no paging is
   needed, but the query is still bounded.
5. **Killing is a write-class action and respects read-only intent (principle §4).** Terminating a
   session changes server state, so the kill action requires the connection **not** be `readOnly`
   (Phase 27) — monitoring (read) is always allowed; killing (write) is gated. Enforced server-side.

## Backend (`apps/api`)

### Driver + a `SessionsService` (in an ops module or `MetadataModule`)
- Add `buildListSessions()` / `buildKillSession(id, mode)` to capable drivers (`pg`, `mysql`),
  aliasing to `DbSession`; advertise `supportsSessionMonitoring`. SQLite: capability off.
- A connection-scoped, ownership-guarded endpoint pair: `GET …/sessions` (snapshot) and
  `POST …/sessions/:id/kill` (mode: `cancel|terminate`) — the kill validates the connection is
  writable (Phase 27), binds the pid as a param, and maps engine errors to safe messages
  (principle §11).

### Tests (Vitest, `apps/api`)
- `buildListSessions` returns the `DbSession` shape per engine; `buildKillSession` binds the pid (no
  interpolation) and picks the right verb per mode; kill on a read-only connection → rejected; SQLite
  reports the capability off; endpoint ownership enforced.

## Frontend (`apps/web` + `packages/ui`)

### Ops panel
- A new **Sessions** ops panel (reachable where connection-level tools live; hidden when
  `supportsSessionMonitoring` is false): a table of live sessions (user, db, state, duration, query,
  blocked-by), sortable client-side over the loaded snapshot (principle §4 — cosmetic), with a
  manual refresh and optional bounded auto-refresh toggle.
- A per-row **Cancel** / **Terminate** action behind `useConfirm`, disabled on read-only connections
  with an explanatory tooltip. Long durations / blocking are visually flagged via tokens. Mobile
  parity as a full-width sheet (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The panel renders sessions from the snapshot; the panel/actions hide when the capability is off;
  Cancel/Terminate issues the right mode; the action is disabled on a read-only connection.

## Verification

### Manual (demo target DBs)
1. PostgreSQL: start a long query in one session, open the Sessions panel in Prost → it appears with
   its duration and state; refresh updates it.
2. Terminate it (confirm dialog) → the query stops; the list reflects the change on refresh.
3. Induce a lock (two transactions) → the blocked session shows its `blockedBy`.
4. MySQL: `SHOW PROCESSLIST`-backed list + `KILL` behave equivalently.
5. SQLite: the Sessions panel is absent (capability off).
6. On a read-only connection: monitoring works; kill is disabled and server-rejected if forced.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Historical/time-series activity metrics or charts (snapshot + manual refresh only; no background
  collection — §13).
- Lock-graph visualization beyond the `blockedBy` column.
- Server-config or replication monitoring.
- Alerting on long-running queries.
