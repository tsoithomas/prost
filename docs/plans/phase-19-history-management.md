# Prost — Phase 19: Query History Management

## Context

`HistoryModule` records every successful query (SQL text only — principle §1) and the Sidebar/
mobile Settings surface a **read-only, click-to-load** recent-queries list. This phase makes
history **manageable**: edit/star/delete entries, full-text search over history, cross-connection
history views, and retention/pruning + export. It extends the existing module (no new boundary)
and reuses the list/load patterns established for snippets in **Phase 13**.

Backlog items (under "Query history" in [`../future-features.md`](../future-features.md)):
editing/starring/deleting entries; full-text search + cross-connection views; retention/pruning
jobs + export.

## Decisions (to confirm before building)

1. **History stays SQL-text-only in the app DB (principle §1).** Editing an entry edits its stored
   SQL text/label; starring sets a flag; nothing about target rows/values is ever stored or
   exported. Export produces **SQL text + metadata** (timestamp, connection name, starred), never
   result data.
2. **All operations are per-user and ownership-checked (principle §3).** `GET`/`PATCH`/`DELETE`
   on history scope by `userId`; another user's entry id → 404. Cross-connection views still only
   show the caller's own history.
3. **Extend the existing contracts, don't fork (principle §6).** `QueryHistoryDto` gains `starred`
   and optional `label`; add `UpdateHistoryRequest` (`label?`, `starred?`) and a
   `HistoryQuery` (search text, `connectionId?` for cross-connection = "all"). Both sides import
   from `@prost/shared-types`.
4. **Search is server-side and bounded (principle §7).** Full-text/`ILIKE` search over the SQL
   text + label, paginated, never "load all history". Cross-connection view is the same query with
   the connection filter relaxed — still paged.
5. **Retention is config-driven and honest (principles §8, §12).** A retention cap (max entries or
   max age per user, env-configurable) pruned by a periodic sweep; **starred entries are exempt**
   from pruning (an explicit, documented rule so users don't lose pinned queries). Pruning is
   logged (principle §12). This is the one place a lightweight scheduled sweep is allowed — scoped
   to app-DB housekeeping, not the general "background jobs" §13 defers.
6. **Delete is reversible-feeling (principle §8).** Single delete and "clear history" route through
   the `useConfirm` danger dialog; "clear" states exactly what's removed (and that starred entries
   are kept, if that's the chosen rule).

## Backend (`apps/api`)

### Prisma + `HistoryModule`
- `QueryHistory` gains `starred Boolean @default(false)` and optional `label String?`; migrate.
- `HistoryService`: `update(userId, id, req)`, `remove(userId, id)`, `clear(userId, opts)`,
  `search(userId, query)` (paged, text + optional connection filter), all ownership-scoped.
- A retention sweep (interval task, `OnModuleInit`/`OnModuleDestroy`) pruning past the configured
  cap, exempting starred; counts logged.
- An `export(userId)` endpoint returning the user's history as JSON/CSV (text + metadata only).

### `HistoryController`
- Extend with `PATCH /connections/:id/history/:entryId` (or a top-level history route for
  cross-connection), `DELETE …/:entryId`, `DELETE …` (clear), `GET …/search`, `GET …/export` —
  all under the JWT guard, ownership asserted.

### Tests (Vitest, `apps/api`)
- Star/label/delete/clear scoped by user; another user's id → 404; search matches text + respects
  paging + connection filter; retention sweep prunes non-starred past the cap and **keeps starred**;
  export contains SQL text + metadata and **no result data** (the §1 guard, tested).

## Frontend (`apps/web`)

### Data layer
- Extend `apps/web/src/api/history.ts` with `useUpdateHistory`, `useDeleteHistory`,
  `useClearHistory`, `useHistorySearch`, `useHistoryExport`; invalidate the list on mutation.

### History UI (Sidebar tab + mobile Settings)
- Per-entry: star toggle, rename (label), delete (danger confirm); a search box; an "All
  connections" toggle for the cross-connection view; an export action; click-to-load unchanged
  (`workspaceStore.loadQuery`, lands in the active tab per Phase 15). Reuse the Phase 13 snippet-
  list interaction patterns. Empty/no-results states. Mobile-first (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- Star/rename/delete call the right hooks; delete + clear fire the danger confirm; search updates
  the list; "All connections" relaxes the filter; click-to-load targets the active tab, no
  auto-run.

## Verification

### Manual (demo target DB, port 5434)
1. Run several queries → star one, rename one, delete one → reflected; starred sorts/filters as
   designed.
2. Search history text → matching entries; toggle "All connections" → entries across connections.
3. Export → a file of SQL text + metadata, **no result rows**.
4. With a low retention cap configured, exceed it → non-starred pruned, starred kept; logged.
5. As another user, the first user's history is invisible; forging an id → 404.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Storing query **results** in history or export (permanently excluded — principle §1).
- Sharing history between users; team history.
- Analytics/dashboards over history usage.
- A general background-job framework — the retention sweep is a single scoped housekeeping task.
