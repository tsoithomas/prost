# Prost — Phase 4: Query History

## Context

Phase 3 executes arbitrary SQL but forgets it the moment results render. Phase 4 persists
executed queries per user/connection and exposes a **recent-queries** panel in the SQL editor:
click a past query to reload it into Monaco (spec §6.8, §5.4).

Everything needed at the data layer already exists: the `QueryHistory` Prisma model
(`apps/api/prisma/schema.prisma` — `id`, `userId`, `connectionId`, `sql`, `executedAt`) and
the `QueryHistoryDto` shape (`packages/shared-types/src/user.ts`). Phase 4 wires recording +
listing on top of Phase 3's execution path.

This phase is deliberately small. The discipline here is **principle §1**: history is app-DB
data, written through **Prisma only**, and it stores **SQL text and identifiers only — never
result rows or credentials** (principle §1, §12).

## Decisions (to confirm before building)

1. **New `HistoryModule`** (spec §6.8, principle §10), app-DB only via Prisma. No `pg` driver
   here — history never touches a target DB.
2. **Recording happens server-side, in the Phase 3 execute path**, not as a separate client
   call. When `QueryModule` runs a statement, it records `{ userId, connectionId, sql,
   executedAt }` through `HistoryModule`. Centralizing it means the client can't forget to log
   and can't forge history entries.
3. **What gets recorded:** SQL text + identifiers only. **Never** bound values (the spec's
   request model already keeps values out of the `sql` string) and **never** result data
   (principles §1, §12). Decide during build whether failed queries are recorded (recommended:
   record attempts with an outcome flag — useful for debugging — but keep MVP simple if it adds
   schema churn; the current model has no outcome column, so default to **recording on
   successful execution only** unless we add a column via migration).
4. **De-duplication / retention:** MVP keeps it simple — list the most recent N (e.g. 50)
   distinct-by-most-recent queries per user+connection, newest first. No pruning job yet; a
   retention/cleanup policy is out of scope (principle §13).
5. **Scope:** history is strictly scoped to `@CurrentUser().userId` **and** the active
   connection. One user never sees another's history; switching connections switches the list.

## Backend (`apps/api`)

### `HistoryModule` (new — `apps/api/src/history/`)

- `history.service.ts` (Prisma only):
  - `record({ userId, connectionId, sql })` → `prisma.queryHistory.create(...)`.
  - `listRecent(userId, connectionId, limit = 50)` → most recent entries, newest first,
    mapped to `QueryHistoryDto[]`. Consider collapsing exact-duplicate consecutive SQL so the
    panel isn't dominated by a re-run query.
- `history.controller.ts`: `GET /connections/:id/history` — JWT-guarded, `@CurrentUser()`-
  scoped, returns `QueryHistoryDto[]`. (No create endpoint — recording is internal to the
  execute path, Decision 2.)
- Wire `QueryModule` (Phase 3) to call `HistoryService.record(...)` after a successful
  execution. Keep the dependency direction clean: `QueryModule` imports `HistoryModule`, not
  vice versa (principle §10).

### Notes

- This is the one phase where **no target-DB SQL is written** — all reads/writes are Prisma
  against the app DB. If you find yourself reaching for `PgConnectionService` here, stop
  (principle §1).
- Recording must not break execution: if the history write fails, log it (structured,
  principle §12) and still return the query result. History is a side effect, not a gate.

## Frontend (`apps/web`)

### Recent-queries panel

- `useQueryHistory(connectionId)` TanStack query hook (`src/api/history.ts`), `enabled` when a
  connection is active — mirrors `useMetadata`'s guard pattern.
- After a successful execute, invalidate the history query so the panel reflects the new entry.
- **Desktop:** the Sidebar already has a **History** tab (`apps/web/src/layout/Sidebar.tsx`,
  currently a placeholder string) — populate it with the recent list scoped to the active
  connection. Clicking an entry loads its SQL into the Monaco editor (set the editor buffer +
  switch to the SQL editor tab via the existing `workspaceStore`).
- **Mobile:** query history is one of the bottom-sheet menu destinations (spec §8.5); render
  the same list there.
- Show `sql` (truncated with full-text on hover/expand) and a relative `executedAt`. Keep it
  read-only — no edit/delete of history entries in MVP.

## Verification

### Unit (Vitest, `apps/api`)
- `HistoryService.listRecent` returns newest-first, correctly scoped by user+connection
  (a second user's / second connection's rows never leak in).
- Recording stores `sql` text only — assert no value/row data fields exist on the model write.

### End-to-end (manual — spec §11 step 7)
1. Run several queries in the SQL editor → each appears at the top of the recent list, newest
   first, for the active connection.
2. Switch connections → the list switches; switch back → original list returns.
3. Click a recent query → its SQL loads into Monaco; re-run works.
4. Confirm (Network tab / DB inspection) that **no result rows or bound values** are persisted —
   only SQL text.
5. Force a history-write failure (e.g. simulate) → the query result still returns; the failure
   is logged, not surfaced as a query error.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Editing, starring, or deleting history entries; saved/named queries or snippets.
- Full-text search over history, cross-connection history views.
- Retention/pruning jobs, history export.
- Recording failed-query attempts with outcome metadata (unless a small migration is approved
  during build, per Decision 3).
