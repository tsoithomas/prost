# Prost — Phase 7: View Schema & Indexes

## Context

The schema browser (`MetadataModule` → `SchemaTree`) today exposes **schemas and table names
only** (`SchemaMetadata` = name + `TableSummary[]`). Column metadata exists
(`MetadataService.getTableColumns`, `ColumnMetadata`) but is consumed solely by the grid for
editability/PK detection — it is never *shown* to the user, and **indexes are not modeled at
all**.

Phase 7 makes table structure visible: selecting a table surfaces a **detail panel** showing
its columns (name, type, nullable, PK) and its **indexes** (name, columns, unique, primary,
method). This is purely additive **read-only** work through the existing
`PgConnectionService` choke point — no DDL, no writes. It is the foundation the DDL stages
(Phase 8 create, Phase 9 alter) build on: you must see an index before you can drop it, and
the detail panel is where "Edit"/"Add index" actions will later live.

Backlog item: "View/edit schema and indexes" in
[`../future-features.md`](../future-features.md) — Phase 7 delivers the **view** half.

## Decisions (to confirm before building)

1. **New `IndexMetadata` type in `@prost/shared-types`** (`metadata.ts`), the single source of
   truth for both apps (principle §6):
   ```ts
   export interface IndexMetadata {
     name: string;
     columns: string[];
     isUnique: boolean;
     isPrimary: boolean;
     method: string;        // btree, hash, gin, …
     definition: string;    // pg_get_indexdef, for display/tooltip
   }
   ```
2. **A dedicated table-detail endpoint, not bloating the tree.** The existing
   `GET /connections/:id/metadata` stays a cheap schema/table list (it powers the sidebar
   tree and must stay fast on big catalogs, principle §7). Columns + indexes for **one** table
   load lazily on selection via a new
   `GET /connections/:id/tables/:schema/:table/structure` → `TableStructure`
   (`{ columns: ColumnMetadata[]; indexes: IndexMetadata[] }`). This mirrors how grid rows are
   a separate per-table fetch rather than embedded in the tree.
3. **Indexes come from `pg_indexes` / `pg_index` + `pg_get_indexdef`**, parameterized on
   schema+table (`$1`/`$2`) like the existing column query — never string-built. Reuse
   `MetadataService.getTableColumns` verbatim for the columns half.
4. **Read-only this phase.** No "Edit"/"Drop" actions yet — the panel renders structure and
   reserves space for the Phase 9 affordances (which arrive disabled-or-absent here, not as
   dead buttons, principle §13 health).
5. **Desktop + mobile both get it** (principle §9): the detail panel is a workspace surface on
   desktop and must have a mobile representation (e.g. within the existing mobile explorer
   flow), not a desktop-only feature.

## Backend (`apps/api`)

### `MetadataService` — index + structure reads

- Add `getTableIndexes(connectionId, schema, table): Promise<IndexMetadata[]>` — parameterized
  query against `pg_indexes`/`pg_index`/`pg_class`/`pg_am` joined to resolve column lists,
  uniqueness, primary flag, access method, and `pg_get_indexdef(indexrelid)` for the display
  definition. Bind schema/table as `$1`/`$2`; no identifier interpolation (principle §2).
- Add `getTableStructure(connectionId, schema, table): Promise<TableStructure>` composing the
  existing `getTableColumns` with the new `getTableIndexes`. Throw `NotFoundException` if the
  table resolves to zero columns (same guard as `GridService.resolveTable`).

### `MetadataController` — new route

- `GET :id/tables/:schema/:table/structure` under the existing JWT guard, calling
  `connectionsService.assertOwnership(user.userId, id)` first (exactly as `getMetadata` does),
  then `metadataService.getTableStructure(...)`. Path params decoded like the grid routes.

### Tests (Vitest, `apps/api`)
- Extend a metadata service test: assert the index query is **parameterized** (schema/table
  bound, not interpolated) and maps `pg_get_indexdef`/uniqueness/primary correctly from a
  representative row set — same assertion style as `grid.service.test.ts`.

## Frontend (`apps/web`)

### Data hook
- `apps/web/src/api/metadata.ts` — add `useTableStructure(connectionId, schema, table)` (a
  TanStack query keyed by all three, enabled only when a table is selected), mirroring the
  existing `useMetadata` hook.

### Table detail panel
- New `apps/web/src/explorer/TableStructurePanel.tsx` (or a workspace "Structure" view):
  - **Columns** section: name, data type, nullable, a PK marker — reuse the PK iconography the
    grid column defs already use.
  - **Indexes** section: name, the column list, `Unique`/`Primary` badges (existing `Badge`
    variants), and the access method; show `definition` in a tooltip or expandable row.
  - Loading / empty (`No indexes`) / error states, consistent with `SchemaTree`'s existing
    loading/error treatment.
- **Wiring:** selecting a table already drives the workspace via `workspaceStore.openTable`.
  Add a way to view structure for the active table — e.g. a "Structure" tab/toggle on the
  table view, or an inline expander in `SchemaTree`. Keep it within the established
  desktop-sidebar / mobile-explorer navigation model (principle §9); don't invent a parallel
  nav.

## Verification

### Manual (demo target DB, port 5434)
1. Select `public.users` → detail panel lists its columns (types, nullability, PK) and its
   indexes, including the primary-key index (marked Primary + Unique) with the correct column
   list and `btree` method.
2. A table with a multi-column or partial index shows the full column list / definition.
3. A table with no secondary indexes shows only the PK index (no crash, no empty flicker).
4. Mobile width (~360px): the structure view is reachable and readable.
5. Ownership: requesting another user's connection id → 404 (guard intact).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- **Editing** anything (column type/nullable/default, add/drop index) → **Phase 9**.
- **Creating** tables → **Phase 8**.
- Constraints beyond PK/unique (foreign keys, checks, exclusion) as first-class panel
  sections — can be added later; this phase covers columns + indexes.
- Index size / bloat / usage stats, `EXPLAIN`-style index advice.
- Views, materialized views, sequences, functions in the structure panel (tree still lists
  base tables only, as today).
