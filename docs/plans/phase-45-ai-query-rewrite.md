# Prost — Phase 45: AI Query-Optimization & Rewrite Advisor

## Context

Phase 33 lets the assistant suggest **index** changes from a plan; Phase 31 gave it a bounded read-only
loop. The natural sibling is **query rewriting**: given an `EXPLAIN` plan and schema-only context, propose
a semantically-equivalent but faster SQL (sargable predicates, avoiding `SELECT *`, better join shape) as
a **candidate loaded into the editor** — never auto-run. This composes Phases 26 (plan), 31 (bounded loop),
and 33 (suggestion pipeline + plan sanitization), and inherits every AI guardrail. It depends on 26, 31,
33.

Roadmap item: Phase 45 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md).

## Decisions (to confirm before building)

1. **Schema-only grounding with the Phase-33 plan-sanitization posture (principles §1, §3).** The advisor
   reasons from `RetrievalService.describeTables` (schema, indexes, FKs) and a `QueryPlanResult` (Phase 26)
   **sanitized by `sanitizePlanForPrompt`** — `planText`/`fields` dropped, `detail` literals redacted. No
   credentials, bound values, or result rows reach the model.
2. **Output is a candidate SQL loaded into the editor, never executed (principles §4, §8).** The assistant
   returns rewritten SQL + a rationale; the user reviews it and runs it manually via the existing
   `workspaceStore.loadQuery` seam (the "Load into editor" path, no auto-execution). The model never runs
   anything.
3. **Bounded, explainable, and capped (principle §11).** Each suggestion carries a rationale tied to the
   plan/metadata it came from ("this filter isn't sargable because…"); suggestions are capped (e.g. ≤3)
   and the model is instructed to return `[]` rather than guess. It is advisory — Prost does not claim
   semantic equivalence, it flags the rewrite for the user to verify.
4. **Reuses the Phase-33 request/render seams, not a new tool (principles §5, §6).** A
   `POST :id/ai/query-suggest` on `AiController` (same throttle triplet as `chat`/`schema-suggest`) returns
   typed rewrite suggestions; the frontend reuses the `SchemaSuggestionList`/`useSchemaSuggestions` pattern
   (rewrite SQL + rationale + "Load into editor"). No stream parsing, no execution path.
5. **Fail safe and observable (principles §11, §12).** Provider failures map to the safe
   `ServiceUnavailableException` (existing behavior); each request is logged by correlation id (SQL text
   only, never values).

## Backend (`apps/api`)

### `AiService.suggestQueryRewrites`
- `resolveEndpoint` → build schema-only context + sanitized plan → JSON-only prompt → parse typed rewrite
  suggestions (each: `sql`, `rationale`), capped. `POST :id/ai/query-suggest` (`@HttpCode(200)`, throttled).
  Pure helpers (prompt build, parse) unit-tested. Reuses `sanitizePlanForPrompt` from Phase 33.

### Tests (Vitest, `apps/api`)
- A rewrite is returned as typed `{sql, rationale}` (not executed); the prompt contains no `planText`, no
  `fields`, no plan literals, no row data; count capped; empty input → `[]`; provider failure → 503.

## Frontend (`apps/web` + `packages/ui`)

### "Suggest rewrite" entry points
- A **"Suggest rewrite"** action in `QueryPlanView`'s toolbar (wired from `SqlEditorView` with the plan +
  statement) and beside the existing chat SQL-block actions; results render as cards (rewritten SQL +
  rationale + **"Load into editor"**) reusing the Phase-33 `SchemaSuggestionList` pattern. Hidden nowhere
  special (it's read-advisory), but never auto-runs.

### Tests (Vitest, `apps/web` — per Phase 12)
- The action requests suggestions and renders cards; "Load into editor" calls `workspaceStore.loadQuery`
  and executes nothing; an empty result shows a graceful state.

## Verification

### Manual (demo target DBs + an LLM endpoint)
1. `EXPLAIN` a query with a non-sargable predicate / `SELECT *` → "Suggest rewrite" → a rewritten SQL with
   a rationale; "Load into editor" places it in Monaco, unrun.
2. Run the rewrite manually and re-`EXPLAIN` → confirm the improvement.
3. Inspect the request → no plan literals, no row data in the prompt; a coaxed empty case returns nothing
   rather than a guess. Provider down → a safe 503, no crash.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Auto-applying or auto-running rewrites (never — §8); formal semantic-equivalence proofs.
- Workload-wide tuning / multi-query optimization (per-statement, interactive only — §13).
- Rewriting DDL or data-mutation statements (read-query rewrites only; data edits are Phase 46).
