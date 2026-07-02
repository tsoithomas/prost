# Prost — Phase 31: Agentic Read-Only Query Execution

## Context

The AI assistant (`AiModule`, Phase 10) is **advisory**: it answers from schema-only context
(`RetrievalService`, ≤8k chars, no credentials/row data — Decision-1 guard) and can load SQL into the
editor, but it never runs anything. Users still hand-run every suggested query and paste results back.
This phase makes the assistant **agentic within strict read-only bounds**: it can, on **explicit user
confirmation**, execute **read-only** queries against the connection to answer a question, then reason
over the results it fetched.

The guardrails are the entire point. It only ever invokes the existing read path through the driver
seam (principle §1); it **never** writes; it refuses on `readOnly`/`prod` connections unless a
statement is provably read-only (Phase 27); and the Decision-1 guard extends to tool results —
**no credentials, bound values, or raw row data are sent back to the model** beyond a bounded,
sanitized summary the user has approved. It depends on Phase 27.

Roadmap item: Phase 31 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **A bounded tool-call loop, read-only tools only (principles §1, §3, §4).** `AiService` gains a
   tool-use loop (the `openai` SDK's tool/function calling) exposing a **single** tool:
   `run_read_query(sql)`. The tool executes **only** through the existing read path
   (`QueryService`/driver seam) and only after the Phase 11/27 analyzer **proves** the statement
   read-only — any non-`SELECT`/ambiguous statement is refused by the tool, not the model. There is no
   write tool. The loop is bounded (max iterations, max total rows/time — principle §7).
2. **Every execution is user-gated (principle §8).** The assistant **proposes** a query and the user
   **confirms** before it runs (a confirm affordance in `ChatPanel`, or an explicit "auto-run
   read-only queries" opt-in the user can toggle per session). Nothing executes silently. A read-only
   connection is required-friendly (read tools are inherently safe there); a `prod`/`readOnly`
   connection still blocks anything the analyzer can't prove is a read.
3. **Tool results are sanitized before returning to the model (principles §1, §3).** What goes back to
   the LLM is a **bounded, truncated** representation (capped rows/columns/cell length), and it still
   honors the Decision-1 posture — the user sees the full result in the grid, the model sees a small
   sample sufficient to reason. Sizes are capped so a large result never balloons the prompt or leaks
   wholesale data.
4. **Results render in the normal grid, editability unchanged (principles §4, §5).** A query the
   assistant runs surfaces in the standard results grid via the existing contract; if it's a
   single-table `SELECT` it's editable exactly as a hand-run one — no new grid, no new editability
   rule. The chat shows what it ran and why.
5. **Fail safe and observable (principles §11, §12).** The tool loop refuses on doubt, surfaces a
   specific message when it declines, and logs each tool invocation (SQL text + correlation id, never
   values) so an agentic session is traceable. Provider failures still map to the safe
   `ServiceUnavailableException` (existing behavior).

## Backend (`apps/api`)

### `AiModule` / `AiService`
- Add a tool-call loop to `AiService.chat` with the `run_read_query` tool wired to
  `QueryService`'s read path via `PoolManager.driverFor`. The tool validates read-only via the
  Phase 11 analyzer + Phase 27 connection guard, executes under the statement timeout, and returns a
  **sanitized/truncated** result to the model. Enforce loop bounds (iterations, rows, time).
- Extend `RetrievalService`/sanitization so tool outputs obey Decision-1 (no credentials/values
  beyond the bounded sample). Log tool calls with the correlation id.

### Tests (Vitest, `apps/api`)
- The tool executes a `SELECT` and returns a truncated sample; a non-`SELECT`/ambiguous statement is
  refused by the tool (not run); a `readOnly`/`prod` connection blocks anything non-provably-read;
  loop bounds cap iterations/rows; the model never receives more than the sanitized cap; a provider
  error maps to `ServiceUnavailableException`.

## Frontend (`apps/web`)

### `ChatPanel`
- When the assistant proposes to run a query, show the SQL + a **confirm** control (Run / Decline);
  an optional per-session "auto-run read-only queries" toggle. Executed queries render their results
  in the normal grid and are annotated in the chat ("ran this to answer…"). Declines/refusals show
  the specific reason. Mobile parity (principle §9), including the bottom-nav AI tab.

### Tests (Vitest, `apps/web` — per Phase 12)
- A proposed query shows the confirm control and doesn't run until confirmed; the auto-run toggle
  gates behavior; results render in the grid; a refusal message renders; the confirm is disabled/
  explained appropriately on a read-only-blocked case.

## Verification

### Manual (demo target DBs + a configured LLM endpoint)
1. Ask "how many orders does the top customer have?" → the assistant proposes a read-only query,
   asks to run it, and on confirm returns the answer with results in the grid.
2. Ask something that would require a write ("delete stale rows") → the assistant explains it won't
   execute writes; no write tool exists.
3. On a `prod`/`readOnly` connection → read questions still work; anything not provably read is
   refused with a clear reason.
4. Ask over a large table → the model's reasoning uses a bounded sample; the full result is in the
   grid; the prompt doesn't balloon.
5. Check logs → each tool call is traced by correlation id with SQL text only (no values).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Any write/DDL tool for the agent (writes stay human-driven; DDL suggestions go through Phase 33's
  preview→confirm pipeline, never an agent tool).
- Multi-connection / cross-database agentic queries.
- Long-running autonomous agents / background tasks (bounded, interactive loop only — §13).
- Sending full result sets to the model (bounded sample only, principle §3).
