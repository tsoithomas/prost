# Prost — Phase 32: Error Explanation & Result Insights

## Context

Two small, high-value AI assists that don't need the agentic loop of Phase 31:

- **Error explanation** — when a query fails, a DB error message is often cryptic
  (`syntax error at or near`, `violates foreign key constraint`). The assistant can explain it in
  plain language and propose a corrected statement to load into the editor.
- **Result insights** — for an already-loaded result page, summarize it in words and offer a **chart**
  (bar/line/pie) of the current page's data — turning the grid into a quick visualization without
  leaving Prost.

Both reuse the existing `AiModule`/`AiProviderService` and stay inside the guardrails: charts are
built **client-side over the already-loaded page** (never a re-fetch or a full-table pull —
principle §7), and anything sent to the model for the error case is the **error text + schema-only
context** (Decision-1 posture, principle §3) — not row data. This depends on nothing.

Roadmap item: Phase 32 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **Error explanation sends the error + schema context, not row data (principles §1, §3).** On a
   failed query, the user can ask the assistant to explain; the request carries the safe error
   envelope (message, error class, correlation id — from principle §11) plus the existing
   `RetrievalService` schema-only context. The model returns an explanation + an optional corrected
   SQL block that loads into the editor via the existing `workspaceStore.loadQuery` (no auto-run —
   Phase 31 governs execution). No bound values or result rows are sent.
2. **Charts are pure client-side presentation over the current page (principles §4, §7).** A chart is
   built from the **already-loaded** result page in the browser — no new fetch, no server round-trip
   for data. The user (or an AI suggestion) picks chart type + the category/value columns; rendering
   uses a lightweight chart lib themed via the existing `--color-data-*`/accent tokens (principle §9).
   This is cosmetic/presentation state, so it may live client-side (principle §4).
3. **AI chart suggestions are hints, not authority (principle §4).** The assistant may **suggest** a
   sensible chart (type + columns) from the **result's column metadata + a bounded sample** (same
   sanitization cap as Phase 31), but the user confirms/edits it. The chart itself never depends on
   the model — if AI is unavailable, manual charting still works.
4. **Insights degrade gracefully with no endpoint (principle §11).** When the user has no
   `LlmEndpoint`, the manual chart + the raw error still work; only the AI explanation/suggestion is
   gated behind the existing "add an endpoint" empty state. No feature hard-depends on AI.
5. **One result contract, a sibling chart view (principle §5).** Charting is a lens over the same
   `GridResponse`/`QueryResult` the grid already renders — no forked result shape; the chart panel
   reads the loaded rows/columns directly.

## Backend (`apps/api`)

### `AiModule` / `AiService`
- An error-explanation entrypoint (or an extension of `chat`) that accepts the safe error envelope +
  schema context and returns an explanation + optional corrected SQL. Reuses `AiProviderService`;
  no row data in the prompt (assert in tests). Optional chart-suggestion response derived from result
  **column metadata** + a bounded sample (Phase 31 sanitization cap).

### Tests (Vitest, `apps/api`)
- The explanation request carries error text + schema only (no values/rows — asserted); a corrected
  SQL block is returned in the expected shape; chart suggestion uses only column metadata + capped
  sample; missing endpoint → the same guarded path as chat.

## Frontend (`apps/web` + `packages/ui`)

### Error explanation
- On a query error, an **Explain this error** action (in the error surface) opens the assistant with
  the explanation; a returned corrected SQL block has a "Load into editor" button (existing pattern).

### Chart view
- A **Chart** toggle on the results panel: choose chart type + category/value columns from the loaded
  result; render client-side with token-driven colors. An **Suggest a chart** action (when an endpoint
  exists) pre-fills the selection. A shared chart primitive in `packages/ui`. Mobile parity — chart
  is full-width and scroll/pinch friendly (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The chart renders from the loaded page without a re-fetch; changing columns/type updates it; the
  explain action opens the assistant with the error; a corrected SQL block loads into the editor; the
  chart works with no endpoint (AI suggestion hidden).

## Verification

### Manual (demo target DBs + optionally an LLM endpoint)
1. Run a broken query (bad column) → "Explain this error" returns a plain-language cause + a corrected
   statement that loads into the editor; no row data leaves in the request.
2. Run `SELECT status, COUNT(*) FROM orders GROUP BY status` → toggle Chart → a bar chart of the
   loaded page renders; switch to pie; colors follow the theme/accent.
3. "Suggest a chart" (with an endpoint) → a sensible type + columns pre-fill; edit and confirm.
4. With no endpoint configured → manual charting + raw error still work; AI actions show the empty
   state.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Server-side aggregation for charts over full tables (client-side over the loaded page only —
  §7; use a `GROUP BY` query for whole-table aggregates, then chart its result).
- Saved/pinned dashboards or persisted chart configs.
- Auto-explaining every error without a user action (opt-in per error).
- Exporting charts as images (separate concern).
