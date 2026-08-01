# Prost — Phase 42: Schema Comparison & Migration Diff (Live-vs-Live)

## Context

Developers routinely ask "how does staging's schema differ from prod's?" and "what DDL reconciles them?"
Prost can browse a schema and execute DDL, but can't **compare** two and generate the delta. This phase
adds a **schema diff** between two live connections (or two schemas on one) — tables, columns, types,
nullability, indexes, FKs — and generates a **DDL change-set** to reconcile them, routed through the
**existing DDL preview→confirm→execute pipeline**. It is a DBA-depth slice depending on Phase 24
(metadata), Phases 8/9 (DDL), and Phase 33 (typed change-request routing). Comparison is **live-vs-live in
memory** so no target schema is persisted to the app DB (§1).

Roadmap item: Phase 42 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md).

## Decisions (to confirm before building)

1. **Compare two live connections, in memory, never persisted (principle §1).** Both schemas are read
   through the existing metadata seam (`MetadataService`) at compare time and diffed **in memory**. No
   schema snapshot is written to the app DB — the boundary holds; a re-compare re-reads live.
2. **The diff is a structured, engine-uniform shape (principles §5, §6).** A `SchemaDiff` in
   `@prost/shared-types` (added / removed / changed tables, columns, indexes, FKs, each with before/after)
   computed from `SchemaMetadata`. Rendered in a diff view (a narrow sibling, not a forked grid). Same
   engine on both sides (cross-engine translation is out of scope).
3. **Reconciliation emits typed DDL for the existing pipeline, never raw SQL (principles §2, §4, §8).** For
   a chosen "source of truth", generate a change-set of typed `AlterTableOperation`s / create-index /
   create-table ops (the same shapes Phases 8/9/33 use), each fed into `DdlService.preview` → SQL preview →
   `useConfirm` → execute. Re-validated against live metadata on execute (§4). The model/diff never
   produces executable SQL directly.
4. **Destructive diffs are surfaced but never auto-selected (principle §8).** Drops (column/table/index) in
   the change-set are shown and clearly flagged, unchecked by default, behind the danger confirm gate; the
   user opts each in.
5. **Blocked on read-only targets, audited (principles §4, §12).** Applying a change-set requires the
   target connection be writable (Phase 25); every applied op is audited (Phase 28). Diffing (read) is
   always allowed, including against `prod`.

## Backend (`apps/api`)

### `SchemaDiffModule` (or in `DdlModule`)
- A connection-scoped, ownership-guarded compare endpoint taking two `{connectionId, schema}` refs, reading
  both via `MetadataService` and returning a `SchemaDiff` (pure diff util, unit-tested). Reconciliation
  reuses `DdlService.preview`/execute per selected op — **no new DDL execution route**.

### Tests (Vitest, `apps/api`)
- The diff util detects added/removed/changed tables/columns/indexes/FKs; the generated change-set is typed
  ops (not raw SQL) validated by `DdlService.preview`; destructive ops require explicit selection; apply on
  a read-only target is rejected and (when applied) audited; no schema persisted to the app DB.

## Frontend (`apps/web` + `packages/ui`)

### Diff view + change-set
- A **Compare schemas** entry (from the database overview) pick two connection/schema refs → a `SchemaDiff`
  view (side-by-side, grouped by object, added/removed/changed styled via tokens). A **"Generate migration"**
  action lists the reconciling ops with checkboxes (destructive unchecked + flagged); "Review & apply"
  routes each through the existing DDL modal/preview → confirm. Mobile parity (§9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The view renders a diff; selecting ops builds the expected change-set; destructive ops are unchecked/
  flagged; apply routes through the DDL preview and is blocked on read-only targets.

## Verification

### Manual (demo target DBs)
1. Point at two Postgres schemas that differ (add a column/index to one) → the diff highlights the delta.
2. Generate a migration with the other as source of truth → the change-set previews correct `ALTER`/`CREATE`
   SQL; confirm the additive ops → re-diff shows them reconciled.
3. A dropped column appears unchecked + flagged; selecting it requires the danger confirm.
4. Applying against a read-only connection is blocked; MySQL/SQLite same-engine compares work.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Persisted schema snapshots / versioning / migration history (live-vs-live only — §1).
- Data diffing (row-level compare); cross-engine schema translation.
- Generating reversible down-migrations.
