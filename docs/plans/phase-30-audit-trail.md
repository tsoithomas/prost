# Prost — Phase 30: Mutation & DDL Audit Trail

## Context

`HistoryModule` records every **successful query** for the recent-queries UI, but it is not an audit
log: it doesn't capture *mutations and DDL specifically*, doesn't record **failures**, and isn't
framed for accountability ("who changed prod, when, and did it succeed?"). This phase adds a
dedicated **audit trail** of write and DDL actions — inserts/updates/deletes, `CREATE`/`ALTER`/`DROP`/
`TRUNCATE`, and imports — with actor, connection, target, outcome, and duration, plus a filterable
viewer.

Even as a single-user tool this matters: it is the record of what Prost did to a database, essential
after a bad change. It writes only to the **app DB** (Prisma), storing SQL text + identifiers — never
row values or credentials (principles §1, §12). It depends on nothing but complements Phase 27 (it's
where a blocked prod write, or an allowed one, is recorded).

Roadmap item: Phase 30 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **A new app-DB model, distinct from `QueryHistory` (principles §1, §6, §10).** Add an
   `AuditEntry` Prisma model: `id`, `userId`, `connectionId`, `action`
   (`insert|update|delete|ddl|import|truncate`), `targetSchema`/`targetTable` (nullable), `sql`
   (statement text, identifiers only), `outcome` (`success|failure`), `errorClass` (nullable),
   `durationMs`, `createdAt`. It never stores bound values, row data, or credentials (principle §1).
   History stays as-is; audit is a separate concern in its own module.
2. **Auditing is a cross-cutting write-path concern, recorded at the choke point (principle §10).**
   Grid writes, `DdlService`, `ImportModule` (Phase 25), and mutating editor statements emit an audit
   entry through a small `AuditService` — recorded on **both success and failure** (a failed prod
   `DROP` is exactly what you want logged). It reuses the Phase 12/§12 correlation id so an audit row
   maps to a server trace.
3. **Failures are first-class (principle §11).** Unlike history (success-only), the audit trail
   records attempts that errored, with the safe error class (not a raw stack), so "someone tried to
   drop X and it failed" is visible.
4. **The viewer is paged and filterable (principle §7).** A per-user audit view lists entries newest-
   first, server-paged, filterable by connection, action, outcome, and date range (compiled to
   parameterized Prisma queries). No unbounded load.
5. **Retention is bounded and honest (principles §7, §12).** An optional cap/retention window
   (config-driven) prunes old entries; pruning is itself not audited as a DB mutation (it's app-DB
   housekeeping). Export of the audit log reuses the Phase 25 CSV/JSON formatter for portability.

## Backend (`apps/api`)

### Prisma + `AuditModule` (new)
- Add the `AuditEntry` model + migration. `AuditService.record(entry)` writes an app-DB row;
  `AuditService.list(query)` returns paged/filtered results (Prisma, parameterized).
- Instrument the write entrypoints — grid update/insert/delete, `DdlService`, `ImportModule`, and
  `QueryService` when the analyzer classifies a statement as mutating — to record success **and**
  failure with duration + correlation id. Storing SQL text + identifiers only (assert no values,
  principle §1).
- `GET /audit` (user-scoped, ownership-guarded, paged/filtered); optional retention prune
  (config-driven) and CSV/JSON export via the Phase 25 formatter.

### Tests (Vitest, `apps/api`)
- A successful grid update records a `success` entry with the right action/target/duration; a failed
  DDL records a `failure` entry with the error class; **no bound values or row data are stored** (a
  test asserts the persisted `sql` carries identifiers but the entry has no value fields); list
  filtering/paging works; retention prune caps growth.

## Frontend (`apps/web` + `packages/ui`)

### Audit viewer
- An **Audit** view (a Sidebar tab or a section in Settings, matching the History tab's patterns):
  a paged list of entries with action/outcome badges, target, duration, and timestamp; filters for
  connection, action, outcome, and date range; an export button (CSV/JSON). Failures are visually
  distinct (token-driven, principle §9). Mobile parity.

### Tests (Vitest, `apps/web` — per Phase 12)
- The viewer renders entries with correct badges; filters compose into the expected request; export
  triggers; failure rows are visually flagged.

## Verification

### Manual (demo target DBs)
1. Inline-edit a cell, insert a row, run a `CREATE INDEX`, import a CSV → each appears in the Audit
   view with action, target, outcome=success, and duration.
2. Attempt a write that fails (e.g. a NOT NULL violation, or a `DROP` on a read-only connection) →
   an outcome=failure entry with the error class appears.
3. Confirm no audit entry contains row values or credentials (inspect the app DB).
4. Filter by connection + action + date; export the filtered list to CSV.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Multi-user attribution beyond the single seeded/invited user (single-user tool — §13).
- Tamper-evident / append-only signed audit storage.
- Auditing pure reads (`SELECT`) — history already covers successful queries; audit is
  mutation/DDL-focused by design.
- Real-time audit streaming / external SIEM export (CSV/JSON export is sufficient for v1).
