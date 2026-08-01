# Prost — Phase 38: Table & Column Documentation (Native Comments)

## Context

Databases carry human documentation as **native object comments** (PostgreSQL `COMMENT ON`, MySQL table/
column `COMMENT` clauses), but Prost neither shows nor lets you edit them — the "what is this column for?"
context is invisible. This phase surfaces existing table/column comments in the structure panel and lets
the user **edit** them through the **existing DDL preview→confirm→execute pipeline** (Phases 8/9), with an
optional AI-drafted first pass. Because comments live in the **target DB**, this respects §1 with no
app-DB documentation store. It is a DBA-depth slice depending on Phase 24 (object browsing) and Phases 8/9
(DDL pipeline).

Roadmap item: Phase 38 in [`roadmap-phase-34-47.md`](./roadmap-phase-34-47.md).

## Decisions (to confirm before building)

1. **Comments are native target-DB metadata, capability-gated (principles §1, §13).** Reading comments
   extends the metadata catalog reads (PG `obj_description`/`col_description`, MySQL
   `information_schema` `TABLE_COMMENT`/`COLUMN_COMMENT`); writing them is benign metadata **DDL**. Add
   `supportsObjectComments` to the descriptor: PG and MySQL advertise it; **SQLite advertises `false`**
   (no comment syntax) and the UI hides it. No engine branch in feature services.
2. **Editing routes through the existing DDL pipeline, no new write path (principles §2, §4, §8).** A
   comment change is a typed DDL operation built by the driver (`COMMENT ON TABLE/COLUMN …` for PG; an
   `ALTER TABLE … MODIFY … COMMENT '…'` / `ALTER TABLE … COMMENT '…'` for MySQL), fed into
   `DdlService.preview` → SQL preview → `useConfirm` → execute. The comment text is **bound/escaped**
   through the driver, never interpolated (§2).
3. **Nothing schema-derived is persisted to the app DB (principle §1).** Comments are read from and
   written to the **target**; Prost keeps no parallel documentation table.
4. **Optional AI draft, never auto-applied (principles §3, §8).** A "Draft with AI" affordance (using the
   Phase-10 endpoints + schema-only `RetrievalService` context) proposes comment text the user edits
   **before** it enters the DDL preview. The model never writes; no row data enters the prompt.
5. **Blocked on read-only, like all writes (principle §4).** Comment editing is a write; it is disabled/
   server-rejected on `readOnly` connections (Phase 25) and audited (Phase 28).

## Backend (`apps/api`)

### Metadata read + `DdlService` write
- Extend the metadata reads to attach `comment` to tables/columns (capability-gated), surfaced in
  `getTableStructure`. Add a `setComment` `AlterTableOperation`/DDL builder per capable driver
  (`drivers/*`), routed through `DdlService.preview`/execute exactly as existing alter ops. SQLite:
  capability off.

### Tests (Vitest, `apps/api`)
- Comments read into table structure per engine; `setComment` builds correctly-escaped DDL (no
  interpolation) for PG and MySQL; SQLite reports the capability off; a comment edit on a read-only
  connection is rejected and audited; preview validates the identifier against live metadata.

## Frontend (`apps/web` + `packages/ui`)

### Comments in `TableStructurePanel`
- Show existing table/column comments; an inline **edit** affordance opens the shared DDL modal (via the
  Phase-33 `ddlStore`/`DdlSuggestionHost` seam or a small `EditCommentModal`) pre-filled, previewing the
  generated SQL before confirm. A **Draft with AI** button fills the field from a model suggestion the
  user edits. Hidden when `supportsObjectComments` is false or the connection is read-only.

### Tests (Vitest, `apps/web` — per Phase 12)
- Comments render in structure; edit opens the preview with the right SQL; AI-draft fills the field and
  still requires confirm; the affordance hides on SQLite / read-only connections.

## Verification

### Manual (demo target DBs)
1. Postgres: add a comment to `users.email` → preview shows `COMMENT ON COLUMN …`; confirm → the comment
   persists and re-appears in structure.
2. MySQL: edit a table comment → the `ALTER TABLE … COMMENT` preview + apply works.
3. "Draft with AI" proposes text; it lands in the field and still requires confirm; no row data in the prompt.
4. SQLite: the comment affordance is absent. A read-only connection: editing is disabled and server-rejected.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Comments on views/functions/triggers/sequences (table + column only for now).
- A separate app-side data dictionary / glossary (native comments only — §1).
- Bulk comment authoring across many columns/tables in one action.
