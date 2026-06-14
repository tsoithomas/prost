# Prost — Phase 16: Multi-Statement Scripts, Transactions & `EXPLAIN`

## Context

The query path assumes a **single statement per execution** — made an explicit, tested guard in
**Phase 11** (§4 there). This phase deliberately lifts that guard: run multiple statements in one
execution, run `BEGIN…COMMIT` transactional blocks, and surface `EXPLAIN`/`EXPLAIN ANALYZE` query
plans. It builds directly on the statement invariant from Phase 11 (we remove a *known* guard) and
on the per-tab execution state from **Phase 15** (a script runs in a tab with its own multi-result
state).

This is the largest editor-track phase because it changes the execution contract: one request can
now yield **multiple results**, span a transaction, or return a **plan** instead of rows.

Backlog item: "Multi-statement scripts, transactions, `EXPLAIN`" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building — these gate safety)

1. **Multi-statement execution runs inside one pooled connection / transaction (principles §1,
   §2).** The server splits the script into statements (a real tokenizer that respects string/
   identifier literals and `$$`-quoted bodies — **not** a naive `;` split), then executes them in
   order on a single client checked out from the existing pool, each still parameterized where
   values are involved. `quoteIdent` discipline unchanged.
2. **Transaction semantics are explicit and honest (principles §8, §11).** A script may wrap work
   in `BEGIN…COMMIT`/`ROLLBACK`; on any statement error the server `ROLLBACK`s the whole batch and
   reports **which statement failed** with the correlation id. Partial-success is never silently
   committed. An implicit-transaction mode ("run all in one transaction") is offered as a toggle.
3. **Results become a list (principle §6 — shared types evolve, not fork).** The execution
   response carries an **array** of per-statement outcomes (`rowsResult | command-tag | plan |
   error`), not a single `QueryResult`. Extend `@prost/shared-types` (`StatementResult[]`,
   discriminated by kind) and adapt the grid/result UI to show per-statement results — the **one
   grid contract (§5)** still renders any row-bearing result; non-row results render as
   status/plan panels.
4. **Editability only ever applies to a lone, single read.** A multi-statement or transactional
   batch is **never** editable (the analyzer already fails safe per Phase 11) — editing only makes
   sense for a single `SELECT` from one base table. This is asserted, not assumed.
5. **`EXPLAIN` is a first-class render, not a feature creep.** `EXPLAIN [ANALYZE] …` returns a plan
   that renders in a readable plan panel (text/tree). `EXPLAIN ANALYZE` actually runs the query —
   the UI labels that clearly (principle §8) so the user knows it executes. (Plans-as-a-first-class
   product feature beyond this remains out of scope per §13.)
6. **Bounded, never load everything (principle §7).** Multi-result and `ANALYZE` output stay within
   the existing paging/row caps; a script producing huge cumulative output is truncated with an
   honest "results truncated" signal, not an OOM.

## Backend (`apps/api`)

### `QueryService` / `QueryModule`
- Replace the Phase 11 single-statement guard with a **statement splitter** (literal-aware) and a
  batch executor: check out one client from the pool, run statements in order (optionally wrapped
  in a transaction), collect a `StatementResult` per statement, `ROLLBACK` on error.
- Detect `EXPLAIN`/`EXPLAIN ANALYZE` and return a `plan` result kind (consider `EXPLAIN (FORMAT
  JSON)` for structured rendering).
- Re-run editability **only** for the single-statement single-`SELECT` case; everything else is
  read-only.
- Honest error mapping: failed statement index + Postgres code → specific message (principle §11);
  observability via existing logging (principle §12).

### Tests (Vitest, `apps/api`)
- Splitter: respects `;` inside string/identifier literals and `$$` bodies; comments; trailing
  semicolons. Batch: order preserved; error mid-batch → rollback + correct failed-index report;
  transaction commit/rollback paths. `EXPLAIN` → plan result; `EXPLAIN ANALYZE` flagged as
  executing. Multi-statement → never editable. Output caps respected.

## Frontend (`apps/web`)

### Execution + results
- The run path (per-tab, Phase 15) handles a `StatementResult[]`: a results area that lists
  per-statement outcomes — row grids (one grid contract, §5), command tags ("UPDATE 3"), or a
  **plan panel** for `EXPLAIN`. A "run as transaction" toggle in the editor toolbar.
- Per-statement error highlighting tied to the failed statement; correlation id surfaced.
- Plan panel: readable text/tree rendering of `EXPLAIN` output, token-styled, mobile-friendly (§9).

### Tests (Vitest, `apps/web` — per Phase 12)
- A `StatementResult[]` renders the right panel per kind; a batch result is non-editable; the
  transaction toggle is sent; an `EXPLAIN ANALYZE` run shows the "this executes" labelling.

## Verification

### Manual (demo target DB, port 5434, on a throwaway table)
1. Run two `SELECT`s in one execution → two result grids, in order.
2. `BEGIN; UPDATE …; UPDATE (bad) …; COMMIT;` → whole batch rolls back; error names the failed
   statement; no partial commit.
3. "Run as transaction" toggle wraps a multi-statement script; a mid-script failure rolls back.
4. `EXPLAIN SELECT …` → plan panel; `EXPLAIN ANALYZE …` → labelled as executing, shows actual
   timings.
5. A single `SELECT` from one table is still editable; a two-statement script is not.
6. A script with a giant cumulative result is truncated honestly, app stays responsive.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Savepoints / nested transactions, cross-tab transactions.
- Query plans as a first-class product feature (visualizer, plan diffing) — §13 keeps this minimal.
- Streaming very large per-statement results — **Phase 22**.
- Scheduled/background script execution (§13 defers background jobs).
