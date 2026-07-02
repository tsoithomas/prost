# Prost — Phase 33: AI Schema-Change Suggestions

## Context

Prost can execute DDL through a disciplined **generate → preview → confirm → execute** pipeline
(`DdlModule`, Phases 8–9) and visualize query plans (Phase 26). This phase lets the AI assistant
**propose schema changes** — most usefully **index recommendations** derived from a slow/`EXPLAIN`'d
query, plus nullability/type/normalization hints — and route them into that **existing DDL pipeline**.
The assistant never applies DDL itself: it produces a candidate change that lands in the DDL preview,
where the user confirms and the server executes exactly as with a hand-authored change.

This is the capstone of the AI track: it composes Phase 26 (a plan to reason about) and Phase 31 (the
bounded loop), and inherits every DDL guardrail already built. It never auto-applies (principle §8),
never sends row data to the model (principle §3), and — like all DDL — is blocked on read-only
connections (Phase 27). It depends on Phases 26 and 31.

Roadmap item: Phase 33 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **Suggestions are grounded in schema + plan, never row data (principles §1, §3).** The assistant
   reasons from `RetrievalService` schema context (tables/columns/indexes/FKs — richer after Phases
   23/24) and, for index advice, a `QueryPlanResult` (Phase 26) — an `EXPLAIN` the user ran. No
   credentials, bound values, or result rows enter the prompt (Decision-1 posture).
2. **Every suggestion is a DDL candidate for the existing pipeline (principles §2, §4, §8).** The
   assistant emits a structured change (e.g. a `CreateIndexRequest`/`AlterTableOperation` shape from
   `@prost/shared-types`), which is fed into `DdlModule`'s **existing** generate→preview→confirm→
   execute flow — same SQL preview, same `useConfirm` danger gate, same server-side validation via
   the driver's `normalize*`/`build*` builders. The model **never** produces raw SQL that executes;
   it produces a request the server compiles and the user approves.
3. **Server re-validates the candidate, never trusts the model (principle §4).** The proposed
   change's identifiers/types are validated against live metadata and the type allow-list (as all DDL
   is today) before preview; an invalid suggestion surfaces a specific error and nothing executes
   (principle §11). A model hallucinating a column can't create bad DDL.
4. **Blocked on read-only, executed only on confirm (principles §4, §8).** Because these are writes,
   they are rejected on `readOnly`/`prod` connections (Phase 27) at the server, and require explicit
   user confirmation via the DDL flow. No auto-apply, ever.
5. **Advice is explainable and bounded (principle §11).** Each suggestion carries a rationale ("this
   query seq-scans `orders.user_id`; an index would…") tied to the plan/metadata it came from, so the
   user can judge it. Suggestions are capped per request; the assistant declines when it lacks grounds
   rather than guessing.

## Backend (`apps/api`)

### `AiModule` + `DdlModule`
- Extend `AiService` to emit **structured DDL-change suggestions** (typed requests, not SQL) from
  schema context + an optional `QueryPlanResult`. Route accepted suggestions into `DdlService`'s
  existing preview/execute path — no new DDL execution route, reusing `normalize*`/`build*` +
  validation. Enforce the Phase 27 read-only guard and the type allow-list.

### Tests (Vitest, `apps/api`)
- A suggestion is emitted as a typed `CreateIndexRequest`/`AlterTableOperation` (not raw SQL); it
  flows through the existing DDL preview and produces the expected parameterized/`quoteIdent`-ed
  statement; an invalid/hallucinated suggestion → 400 at validation, nothing executed; a read-only
  connection → rejected; no row data in the suggestion prompt (asserted).

## Frontend (`apps/web`)

### `ChatPanel` → DDL preview
- When the assistant proposes a schema change, render it with its rationale and a **Review change**
  action that opens the **existing DDL preview modal** (from Phases 8–9) pre-filled with the candidate
  — the user sees the generated SQL, confirms the danger gate, and executes through the normal path.
  On read-only connections the review is blocked with an explanation (mirrors the server guard).
  Mobile parity (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- A suggestion renders with rationale and opens the DDL preview pre-filled; the preview shows the
  generated SQL; confirm executes via the existing flow; a read-only connection blocks review; an
  invalid suggestion surfaces the server error.

## Verification

### Manual (demo target DBs + an LLM endpoint)
1. `EXPLAIN` a query that seq-scans a filtered column (Phase 26) → ask the assistant for index advice
   → it proposes a `CREATE INDEX` with a rationale.
2. "Review change" → the existing DDL preview opens with the generated SQL; confirm → the index is
   created; re-`EXPLAIN` shows it used.
3. Ask on a `prod`/`readOnly` connection → review is blocked in UI and rejected server-side.
4. Coax an invalid suggestion (nonexistent column) → validation rejects it with a clear message;
   nothing runs.
5. Confirm no row data was included in the suggestion request (logs/prompt inspection).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Auto-applying any schema change without the user's DDL-preview confirmation (never — principle §8).
- Data migrations / backfills as suggestions (schema-shape changes only).
- Stored-procedure/trigger generation (editing those stays frozen — §13).
- Continuous/background index advising over query workload (interactive, per-request only — §13).
