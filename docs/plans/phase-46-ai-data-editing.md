# Prost — Phase 46: AI-Assisted Data Editing with Preview

## Context

This is the AI track's capstone. The assistant can answer from schema (Phase 10), run **read-only** queries
(Phase 31), and suggest **DDL/index** changes routed through the confirm-gated pipeline (Phase 33). What it
still can't do is help **change data** safely. This phase lets it **propose row-level data changes**
(`UPDATE`/`DELETE`/`INSERT`) as **typed, previewed candidates** routed through the **existing confirm-gated
write pipeline** — the model never executes, every candidate is server-validated and shown as parameterized
SQL with an affected-row estimate before the user confirms. It composes Phases 25, 31, 33, and the Phase-45
request-time suggestion pattern.

Roadmap item: Phase 46 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md). Depends on 25, 31, 33, 45.

## Decisions (to confirm before building)

1. **The model proposes a typed data-mutation candidate, never raw executable SQL (principles §2, §4,
   §8).** A suggestion is a structured change (target table + PK-scoped set/where, or an insert shape) that
   the server compiles into a **parameterized** statement via the existing write builders — the same shapes
   grid edits use. The model emits a request; the server builds the SQL; the user approves.
2. **Server re-validates against live schema + editability, and previews before any write (principles §4,
   §8).** Each candidate runs through a **data-mutation preview** (analogous to `DdlService.preview`):
   identifiers validated against live metadata, target proven editable (single table, PK present — the
   Phase-4 editability rule), and a **parameterized SQL + affected-row estimate** shown. A candidate that
   fails validation is **dropped**; the execute path re-validates regardless.
3. **Blocked on read-only before any provider call (principles §4, §8; Phase 25).** Because these are
   writes, `PoolManager.assertWritable` rejects the request (403) on `readOnly` connections **before** the
   LLM is called — no spend on an inapplicable request — exactly as Phase 33 does for DDL. The entry points
   are hidden on read-only connections.
4. **Confirm-gated, PK-keyed, audited — never auto-applied (principles §8, §12).** Applying requires the
   user to confirm the previewed statement (behind `useConfirm`), every write is PK-keyed, and every
   applied change is recorded in the audit trail (Phase 28) on success and failure.
5. **No row data to the model beyond the bounded Phase-31 sample (principles §1, §3).** Any rows the
   assistant reasons over come through the Phase-31 read tool's **bounded, sanitized** sample the user
   approved; the suggestion prompt/response never carries wholesale row data.

## Backend (`apps/api`)

### `AiService.suggestDataChanges` + a data-mutation preview
- `assertWritable` (before any provider call) → resolve tables/context → JSON-only prompt → parse typed
  data-change candidates (allow-listed to `update`/`delete`/`insert`, PK-scoped) → a **data-mutation
  preview** that validates identifiers + editability and compiles the parameterized statement + affected-row
  estimate; invalid candidates dropped. `POST :id/ai/data-suggest` (`@HttpCode(200)`, throttled). Applying
  reuses the existing grid write path (PK-keyed, parameterized, audited) — **no new execution route**.

### Tests (Vitest, `apps/api`)
- A suggestion is a typed candidate (not raw SQL) compiled to a parameterized statement; a non-editable
  target / bad identifier candidate is dropped; a read-only connection → 403 **and** the provider was never
  called; the prompt carries no wholesale row data; applying is PK-keyed and audited; provider failure → 503.

## Frontend (`apps/web` + `packages/ui`)

### Data-change suggestions + preview
- Entry points (hidden on read-only connections): a "Suggest data fix" affordance in the grid/table context
  and beside chat SQL blocks. Suggestions render as cards (natural-language intent + the compiled
  parameterized SQL + affected-row estimate + rationale); **"Review change"** opens a preview/confirm
  (reusing the Phase-33 `ddlStore`/host seam, generalized to data mutations) → on confirm the change applies
  through the normal write path; results refresh in the grid.

### Tests (Vitest, `apps/web` — per Phase 12)
- A suggestion renders with the compiled SQL + affected-row count and executes nothing until confirmed;
  "Review change" routes to preview/confirm; the entry points hide on read-only connections; applying
  refreshes the grid.

## Verification

### Manual (demo target DBs + an LLM endpoint)
1. Ask the assistant to "set status to shipped for orders older than 30 days" → a candidate `UPDATE` with a
   parameterized preview + affected-row estimate; **Review change** → confirm → the rows update; the grid
   refreshes; the audit log records it.
2. Coax an invalid candidate (nonexistent column / a join target) → it's dropped; nothing runs.
3. On a `readOnly`/`prod` connection → the entry points are hidden and the endpoint 403s **before** any
   provider call.
4. Inspect the request → no wholesale row data in the prompt; provider down → safe 503.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Auto-applying any data change without the user's preview confirmation (never — §8).
- Unbounded/multi-statement migrations or backfills; autonomous multi-step data edits without per-step
  confirmation.
- Mixed schema+data change-sets in one suggestion (DDL suggestions stay Phase 33; rewrites stay Phase 45).
