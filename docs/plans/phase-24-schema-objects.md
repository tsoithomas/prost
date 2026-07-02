# Prost — Phase 24: Broader Schema-Object Browsing

## Context

The schema tree browses **tables only**. Real databases also hold views, materialized views,
sequences, functions/procedures, triggers, and (on PostgreSQL) enum types — all currently invisible
in Prost. This phase surfaces them **read-only**: new node kinds in the schema tree with detail
panels showing each object's definition. It is purely additive metadata (principle §1, §7) and adds
no write path.

`architecture-principles.md` §13 freezes *stored-procedure/trigger editors*. **Browsing** these
objects is not editing them — this phase reads and displays definitions only, and the §13 amendment
(see the roadmap) clarifies that distinction before this phase lands. It depends on nothing.

Roadmap item: Phase 24 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **Object listing is capability-gated per engine (principles §1, §13).** Add metadata builders to
   `DbDriver` for the object kinds each engine supports, advertised via `DbCapabilities` (e.g.
   `supportsViews`, `supportsMaterializedViews`, `supportsSequences`, `supportsRoutines`,
   `supportsTriggers`, `supportsEnums`). SQLite has views + triggers but no sequences/procedures/
   enums; MySQL has no materialized views or enum *types* (its `ENUM` is a column type); PostgreSQL
   has all. The frontend renders only the kinds the descriptor advertises — no engine branch in
   feature code.
2. **One generic "schema object" shape in `@prost/shared-types` (principle §6):**
   ```ts
   export type SchemaObjectKind =
     | 'view' | 'materializedView' | 'sequence' | 'function' | 'procedure' | 'trigger' | 'enum';
   export interface SchemaObjectSummary {
     kind: SchemaObjectKind; schema: string | null; name: string; comment?: string;
   }
   export interface SchemaObjectDetail extends SchemaObjectSummary {
     definition?: string;         // view/function/trigger source, or CREATE text
     columns?: ColumnMetadata[];  // for views/materialized views (projected columns)
     extra?: Record<string, string>; // engine-specific: enum labels, sequence current value, …
   }
   ```
3. **Definitions come from catalogs, never reconstructed by hand.** PostgreSQL `pg_get_viewdef` /
   `pg_get_functiondef` / `pg_get_triggerdef`; MySQL `SHOW CREATE VIEW` / `information_schema.ROUTINES`
   / `SHOW CREATE TRIGGER`; SQLite `sqlite_master.sql`. All read-only, parameterized where the
   catalog function allows.
4. **Views render in the existing grid when selected (principle §5).** Selecting a view/materialized
   view loads its rows through the **same paginated read path** as a table (a view is a relation);
   it is read-only (not a single updatable base table, so the editability analyzer already marks it
   non-editable — no new rule). Sequences/functions/triggers/enums show a **definition panel only**,
   not a grid.
5. **No execution, no editing (principle §13).** Functions/procedures are displayed, never invoked;
   triggers are displayed, never toggled. This phase adds zero write or execute paths for these
   objects — that stays frozen.

## Backend (`apps/api`)

### Driver + `MetadataService`
- Add per-kind list + detail builders to `DbDriver` (capability-gated), implemented in each
  `*-sql.ts`; extend `DbCapabilities` with the `supports*` flags and the descriptor the frontend
  reads. Aliases normalize to `SchemaObjectSummary`/`SchemaObjectDetail`.
- `MetadataService` exposes new endpoints (e.g. `GET /connections/:id/schemas/:schema/objects` and a
  detail route), each resolving the driver via `PoolManager.driverFor` — no engine branch.
- Selecting a **view** reuses the existing rows endpoint (a view is a valid `TableRef` target).

### Tests (Vitest, `apps/api`)
- Extend `runDriverContractTests`: create a view + trigger (+ sequence/enum on engines that support
  them), assert list + detail builders return them with definitions; capability-absent kinds are
  skipped, not errored. Metadata service returns objects grouped by kind and honors capabilities.

## Frontend (`apps/web` + `packages/ui`)

### Schema tree
- `Sidebar.tsx` / `MobileExplorerView.tsx`: under a schema, add collapsible groups per object kind
  the descriptor advertises (Tables, Views, Materialized Views, Sequences, Functions, Procedures,
  Triggers, Enums). Empty/unsupported groups are hidden.

### Detail rendering
- Selecting a **view/materialized view** opens it in the standard grid (read-only). Selecting a
  non-relation object opens a **definition panel** (token-styled, syntax-highlighted via the shared
  Monaco read-only view) showing the source + engine extras (enum labels, sequence value). Mobile
  parity (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The tree renders only the kinds the descriptor advertises; selecting a view routes to the grid;
  selecting a function shows its definition; unsupported kinds don't appear for SQLite/MySQL.

## Verification

### Manual (demo target DBs)
1. PostgreSQL (:5434): a schema shows Views/Sequences/Functions/Triggers/Enums groups. Add a demo
   view → it appears; selecting it loads rows read-only; selecting a function shows its source.
2. MySQL (:3307): Views + Triggers + Procedures appear; no Materialized Views / Enum-type / Sequence
   groups (capabilities off).
3. SQLite: Views + Triggers appear; no sequences/procedures/enums.
4. Confirm no edit/execute affordance exists on any function/procedure/trigger.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Creating/altering/dropping any of these objects (stored-procedure/trigger **editing** stays frozen,
  §13).
- Executing functions/procedures or refreshing materialized views from the UI.
- Dependency graphs between objects (what a view/function references).
- Column-level lineage.
