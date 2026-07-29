# Prost — Phase 40: On-Demand Query-Performance Insights & Index Advisor

## Context

Prost can visualize a single query's plan (Phase 26) and monitor live sessions (Phase 27), but there is no
"which statements are slow on this database, and what would help?" view. Every engine keeps such data:
PostgreSQL's `pg_stat_statements`, MySQL's `performance_schema`. This phase adds an **on-demand
performance panel** that browses top statements and, from a slow one, offers **index suggestions** through
the **existing Phase-33 DDL-suggestion pipeline**. It is a DBA-depth slice depending on Phases 26, 27, 33.
Crucially it stays **on-demand** — a snapshot the user pulls — so it introduces no background collection
and remains inside §13.

Roadmap item: Phase 40 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md).

## Decisions (to confirm before building)

1. **Capability-gated, on-demand snapshot through the driver seam (principles §1, §7, §13).** Add
   `supportsPerfInsights` to the descriptor; capable drivers implement `buildListTopStatements()` reading
   `pg_stat_statements` (PG, **if the extension is present** — degrade to a clear "not available"
   otherwise) / `performance_schema` (MySQL). **SQLite advertises `false`.** The panel fetches a snapshot
   on open and on explicit refresh — **no background collection, no time-series** — so the frozen
   "continuous/workload index advising" line is respected because the user drives each request.
2. **One statement-stat shape in `@prost/shared-types` (principle §6).** A `StatementStat` (normalized
   query text, calls, total/mean time, rows) — **query text only, never bound values or result rows**
   (principles §1, §12), consistent with history/session monitoring.
3. **Index advice reuses the Phase-33 pipeline, not a new one (principles §2, §4, §8).** From a slow
   statement the user can request **index suggestions**: the statement is `EXPLAIN`'d (Phase 26) and fed
   into `AiService.suggestSchemaChanges` (Phase 33) — typed `createIndex` candidates re-validated by
   `DdlService.preview`, confirmed and executed through the **existing** DDL flow. No new suggestion or
   execution path; the Phase-33 `sanitizePlanForPrompt` posture applies (no literals/rows to the model).
4. **Reads are bound and safe (principles §2, §4).** Snapshot queries are parameterized/bounded; the panel
   is pure read and works on read-only/`prod` connections. Any statement re-`EXPLAIN`'d for advice uses the
   read-only `EXPLAIN` (not `ANALYZE`) unless the user explicitly opts into analyze (Phase 26 gate).

## Backend (`apps/api`)

### Driver + a perf read (ops module / `MetadataModule`)
- Add `buildListTopStatements()` to capable drivers, aliasing to `StatementStat`; advertise
  `supportsPerfInsights`; detect and report the `pg_stat_statements` extension gracefully. A
  connection-scoped, ownership-guarded `GET …/perf/statements` snapshot endpoint. Index advice composes
  the existing `EXPLAIN` + Phase-33 `suggestSchemaChanges` — no new route beyond the snapshot.

### Tests (Vitest, `apps/api`)
- `buildListTopStatements` returns `StatementStat` (text only, no values) per engine; the extension-missing
  path returns a clear unavailable signal, not an error; SQLite reports the capability off; the advice path
  routes through Phase 33's validated pipeline; ownership enforced.

## Frontend (`apps/web` + `packages/ui`)

### Performance panel
- A **Performance** ops panel (hidden when `supportsPerfInsights` is false / extension absent): a sortable
  snapshot table of top statements (text, calls, mean/total time, rows) with manual refresh; a per-row
  **"Suggest indexes"** action rendering the Phase-33 `SchemaSuggestionList` (review → existing DDL modal
  → confirm). Mobile parity as a full-width sheet (§9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The panel renders the snapshot and hides when unsupported; "Suggest indexes" invokes the Phase-33 flow;
  the extension-missing state shows an explanatory empty state; refresh re-fetches.

## Verification

### Manual (demo target DBs)
1. Postgres with `pg_stat_statements` → run some queries, open the panel → top statements appear with
   timing; refresh updates them.
2. "Suggest indexes" on a slow seq-scanning statement → a `CREATE INDEX` candidate (Phase 33) → confirm →
   re-run shows improvement.
3. Postgres **without** the extension → a clear "not available, enable pg_stat_statements" empty state, not
   an error. MySQL `performance_schema` behaves equivalently. SQLite: panel absent.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Historical/time-series performance metrics, plan-history diffing over time, dashboards (no background
  collection — §13).
- Continuous/workload-based automatic index advising (interactive, per-request only — §13).
- Alerting on slow queries; resetting/`pg_stat_statements` administration.
