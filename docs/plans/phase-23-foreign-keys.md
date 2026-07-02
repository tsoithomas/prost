# Prost — Phase 23: Foreign-Key Metadata & Relational Navigation

## Context

The schema layer surfaces columns, primary keys, and indexes per table, but **foreign keys are
invisible**: there is no `buildListForeignKeys` on the `DbDriver` interface
(`apps/api/src/database/db-driver.interface.ts`), FKs appear only in migration SQL, and the grid
offers no way to jump from a referencing value to the row it points at. This phase adds FK metadata
end-to-end and turns it into **relational navigation** — the single most-requested TablePlus-style
affordance and the foundation an ER diagram (later, optional) would build on.

It is a **read-only metadata + navigation** slice: it adds one capability-gated driver builder and a
navigation gesture that reuses the Phase 14 filter path. It depends on nothing and unblocks Track A
depth work. New engine behavior stays behind the driver + descriptor (principle §1), and the
navigation click compiles to the **same parameterized `RowFilter`** Phase 14 already validates
(principle §2).

Roadmap item: Phase 23 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **FK metadata is a new capability-gated driver builder (principles §1, §13).** Add
   `buildListForeignKeys(ref: TableRef): SqlFragment` to `DbDriver`, implemented per engine:
   PostgreSQL via `pg_constraint`/`pg_attribute` (`contype = 'f'`), MySQL via
   `information_schema.KEY_COLUMN_USAGE` joined to `REFERENTIAL_CONSTRAINTS` (for
   `ON DELETE`/`ON UPDATE`), SQLite via `PRAGMA foreign_key_list(<table>)`. The columns are aliased
   to one shape so no feature service branches on engine. Engines all support FKs, so this is not a
   skipped capability — but the conformance suite exercises it on each.
2. **New shared type in `@prost/shared-types` (principle §6):**
   ```ts
   export interface ForeignKeyMetadata {
     constraintName: string;
     columns: string[];              // local columns, ordered
     referencedSchema: string | null; // null where the engine has no schema namespace
     referencedTable: string;
     referencedColumns: string[];    // 1:1 with columns
     onDelete?: string;              // 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | …
     onUpdate?: string;
   }
   ```
   `TableMetadata` (or the structure-panel DTO) gains `foreignKeys: ForeignKeyMetadata[]`.
3. **Navigation compiles to a Phase 14 `RowFilter`, not new SQL (principles §2, §4).** Clicking a FK
   value opens the **referenced** table with an `and`-combined `eq` filter over its
   `referencedColumns` bound to the clicked row's values. No new query path — it reuses the existing
   validated rows endpoint + filter compiler. The referenced table is opened as a table tab via
   `workspaceStore`.
4. **The reverse direction is offered but not preloaded (principle §7).** From a parent row, "show
   referencing rows" builds the inverse filter on the child table (again a `RowFilter`); it is an
   explicit action, never an eager fetch, so we never load more than a page.
5. **Composite keys are first-class.** Multi-column FKs produce a multi-condition filter; a
   navigation is only offered when every FK column value is present in the current projection
   (mirrors the editability PK rule, principle §4).

## Backend (`apps/api`)

### Driver layer (`apps/api/src/database/`)
- Add `buildListForeignKeys(ref)` to `db-driver.interface.ts` and implement in `pg-driver`,
  `mysql-driver`, `sqlite-driver` (their `*-sql.ts` builders), aliasing to the
  `ForeignKeyMetadata` shape. Identifiers via `quoteIdent`; the table name binds as a param where
  the catalog query allows.
- Extend `runDriverContractTests` (`apps/api/src/database/testing/`) with an FK case: create two
  related tables, assert the builder returns the constraint with correct local/referenced
  columns and actions (capability-uniform — all three engines run it).

### `MetadataService`
- Include `foreignKeys` when returning table structure (the panel/DTO consumed by
  `TableStructurePanel`), resolved through `PoolManager.driverFor(connectionId)` — no engine
  branch in the service.

### Tests (Vitest, `apps/api`)
- Each driver's FK builder produces the expected parameterized fragment; the metadata service
  merges FKs into the structure response; composite FK returns ordered column pairs.

## Frontend (`apps/web` + `packages/ui`)

### Structure panel
- `TableStructurePanel.tsx` gains a **Foreign keys** section (constraint name, local → referenced
  columns, on-delete/on-update), token-styled, alongside the existing columns/indexes.

### Grid navigation
- In the grid, a cell belonging to an FK column shows an affordance (icon/link) to **"open
  referenced row"**; clicking builds the `RowFilter` and opens the referenced table tab via
  `workspaceStore.loadTable` (or the equivalent). A row context action offers **"show referencing
  rows"** for the inverse direction.
- FK awareness comes from the server metadata only — the frontend never infers relationships.
  Mobile parity: the actions live in the row/cell action sheet (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The structure panel renders FK rows from metadata; clicking an FK value produces the expected
  `RowFilter` and target table; composite FK builds a multi-condition filter; navigation is hidden
  when an FK column is absent from the projection.

## Verification

### Manual (demo target DBs — PG :5434 and MySQL :3307 both have `orders.user_id → users.id`)
1. Open `orders` → the structure panel lists the `user_id → users(id)` foreign key with its actions.
2. Click a `user_id` value → the `users` table opens filtered to that `id` (one matching row).
3. From a `users` row, "show referencing rows" → `orders` opens filtered to that `user_id`.
4. On MySQL `order_items` (composite key) → the composite FK renders and navigates on all columns.
5. On SQLite (a related pair) → the same behavior via `PRAGMA foreign_key_list`.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- ER diagram rendering (optional follow-up; needs the §13 amendment — see the roadmap).
- Editing/creating/dropping foreign-key constraints (DDL FK support is a later slice; this is
  read + navigate only).
- Auto-joining referenced columns into the grid (navigation opens a separate tab, not an inline
  join — the one-table editability contract stays intact, principle §4).
- Cross-connection navigation (a FK always resolves within the same connection).
