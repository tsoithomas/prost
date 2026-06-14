# Prost — Phase 22: Streaming / Cursor-Based Large Result Sets

## Context

Results today use AG Grid's Infinite Row Model over **offset/limit paging** through the rows/query
endpoints (principle §7 — never load everything). For very large result sets, repeated `OFFSET`
paging degrades (the database re-scans), and a single huge `SELECT` in the SQL editor still
materializes a page at a time without a true stream. This phase adds **cursor/stream-based
results**: server-side cursors (`DECLARE … CURSOR` / node-postgres `pg-cursor`) so large reads are
fetched in stable chunks without growing offsets, and a streaming response to the grid.

It is the largest performance change and lands **last** in the editor track: it benefits from the
execution model settled in **Phase 16** (a result is already a typed, possibly-multi outcome) and
keeps the **one grid contract** (principle §5) intact — the grid still renders rows, only the
fetch protocol underneath changes.

Backlog item: "Streaming/cursor-based results beyond simple paging" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **Cursors run inside a transaction on a single pooled client (principles §1, §2).** A streamed
   read `BEGIN`s, `DECLARE`s a cursor for the (parameterized) query, and `FETCH`es N rows per page;
   the client is held for the cursor's lifetime and released (with `ROLLBACK`/`CLOSE`) on
   completion, error, or timeout. This must respect the Phase 11 pool lifecycle (a held client
   counts against pool size; long-idle cursors are reaped — principle §12).
2. **Stable pagination replaces growing `OFFSET` (principle §7).** The Infinite Row Model's
   "give me rows X..Y" maps to sequential cursor `FETCH`es (forward-only in v1), so the database
   doesn't re-scan. The existing offset path stays as the default for small/normal results; cursor
   mode engages for large reads (heuristic or explicit), so nothing regresses for the common case.
3. **Bounded and reapable, never unbounded (principles §7, §12).** A streamed query has a max total
   rows/time budget and an idle-cursor reaper (closes cursors abandoned by the client). Truncation
   is signalled honestly to the grid ("results truncated at N", principle §11) — never silent, never
   OOM.
4. **Editability and the result contract are unchanged in shape (principles §4, §5, §6).** A
   cursor-streamed single-`SELECT` from one base table stays editable exactly as a paged one does;
   the `QueryResult`/`StatementResult` shape the grid consumes doesn't fork — streaming is a
   delivery detail behind the same contract. Any session/cursor handle added to shared types is
   additive.
5. **Honest lifecycle and errors (principles §11, §12).** Cursor open/fetch/close and reaps are
   logged with the correlation id; a mid-stream error or a reaped cursor surfaces a specific message
   and the grid recovers (re-issues from the start) rather than wedging.

## Backend (`apps/api`)

### `PgConnectionService` / `QueryService` / `GridService`
- Add a cursor-backed read path (`pg-cursor` or explicit `DECLARE/FETCH`): open a cursor on a
  checked-out client, expose `fetch(n)` and `close()`, tracked alongside the Phase 11 pool
  lifecycle (held client accounting + idle reaper).
- A session/handle map (server-side) correlating a client cursor to subsequent fetch requests, with
  TTL reaping; engage cursor mode by heuristic (expected large result) or an explicit flag, falling
  back to the existing offset path otherwise.
- Enforce total-row / time budgets; signal truncation in the response (principle §11).

### Endpoints
- Either a streaming variant of the rows/query endpoints (chunked/SSE) or a stateful
  fetch-by-handle endpoint the Infinite Row Model calls for successive blocks — pick one and keep
  the grid contract (§5) stable. Ownership asserted like every connection-scoped route.

### Tests (Vitest, `apps/api`)
- Cursor opens in a transaction and `CLOSE`s on completion/error; sequential fetches return correct
  ordered blocks without `OFFSET` growth; idle cursor is reaped and the client released; held
  cursors respect pool limits (Phase 11); truncation budget enforced and signalled; a single-SELECT
  stream is still editable; offset fallback unchanged for small results.

## Frontend (`apps/web`)

### Grid datasource
- Extend the Infinite Row Model datasource to consume the streamed/fetch-by-handle protocol for
  large results, transparently falling back to offset paging for normal ones — **the grid component
  itself is unchanged** (principle §5). Handle a reaped/expired cursor by restarting the datasource
  from the top with an honest notice.
- Surface "results truncated at N" and stream/loading state in the existing results UI; mobile
  parity (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The datasource requests sequential blocks via the streaming protocol; a reaped-cursor response
  restarts cleanly; truncation notice renders; small results still use the offset path.

## Verification

### Manual (a large table on the demo target DB, port 5434 — seed many rows)
1. Open a multi-million-row table → rows stream in stable chunks; scrolling deep stays responsive
   (no growing-OFFSET slowdown vs. the old path).
2. Run a large `SELECT` in the editor → same streamed behavior; truncation notice appears at the
   budget.
3. Abandon a stream (navigate away) → server logs show the cursor reaped and the client released;
   pool size recovers (Phase 11).
4. A single-table streamed `SELECT` is still editable; a join/CTE stays read-only.
5. A small query still uses the plain offset path (no regression).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Backward/random-access cursor scrolling (forward-only fetch in v1).
- Server-side result caching / materialization across requests beyond the live cursor.
- Exporting full large result sets to file (a separate export feature; history export in Phase 19
  is text-only).
- WebSocket transport — chunked HTTP/SSE is sufficient for v1.
