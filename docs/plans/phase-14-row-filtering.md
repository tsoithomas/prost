# Prost — Phase 14: Row Filtering (Column `WHERE` Builder)

## Context

The TableView toolbar already has a **"Filter" `IconButton` rendered disabled** with a
"Filtering — coming soon" tooltip (`TableView.tsx`). This phase wires it up: a per-column filter
that compiles to a **parameterized `WHERE` clause** fed into the existing paginated rows endpoint
(`/connections/:id/tables/:schema/:table/rows`). It is the first feature to extend the grid's
data path with user-supplied predicates — so the parameterization discipline (principle §2) is
the whole game.

It depends on **Phase 11** (the editability fail-safe and statement guard make the read path's
invariants explicit) and slots cleanly onto the existing Infinite Row Model paging (principle §7).

Backlog item: "Row filtering (column-level `WHERE` builder)" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building — these gate safety)

1. **Filters are structured operations, never raw SQL (principles §2, §4).** The client sends a
   typed list of column predicates; the **server** compiles them to a `WHERE` with `$n`
   placeholders and `quoteIdent`-ed column names. The browser never sends SQL text for the filter
   — that would reopen the injection surface the whole architecture closes.
2. **New shared types in `@prost/shared-types` (principle §6):**
   ```ts
   export type FilterOperator =
     | 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'
     | 'contains' | 'startsWith' | 'endsWith' | 'isNull' | 'isNotNull' | 'in';
   export interface ColumnFilter { column: string; operator: FilterOperator; value?: unknown; values?: unknown[]; }
   export interface RowFilter { conditions: ColumnFilter[]; combinator: 'and' | 'or'; }
   ```
   The existing rows-query DTO gains an optional `filter: RowFilter`.
3. **Columns are validated against live metadata (principle §4).** Each `column` is confirmed to
   exist on the target table (reuse `MetadataService`) before compilation; an operator must be
   valid for the column's type family (e.g. `contains` only on text). Unknown column/operator →
   specific `400` (principle §11), nothing executed.
4. **Operators map to safe, parameterized SQL.** `contains`/`startsWith`/`endsWith` → `ILIKE`
   with the wildcard added to the **bound value**, not the SQL string; `in` → `= ANY($n)` with an
   array param; `isNull`/`isNotNull` → no parameter. All values bind as `$n` (principle §2).
5. **Filtering composes with paging, not replaces it (principle §7).** The `WHERE` is applied to
   the same offset/limit query the grid already issues; the total/row-count path accounts for the
   filter so the Infinite Row Model still knows when to stop.
6. **Editability is re-derived under filter.** A filtered single-table read stays editable exactly
   as it is today (the filter doesn't change the base table) — confirm the editability analyzer
   (Phase 11) treats `SELECT … WHERE …` on one table as editable.

## Backend (`apps/api`)

### `GridService` (rows path)
- Accept the optional `RowFilter` on the rows query; a `compileWhere(filter, columns)` helper
  validates columns/operators against metadata and returns `{ sql: 'WHERE …', params: [...] }`
  with `$n` placeholders offset correctly relative to existing paging params.
- Thread the compiled clause + params through the existing `runParameterized` call; apply the same
  clause to the count query.
- Map validation failures to `400` with the offending column/operator named (principle §11).

### Tests (Vitest, `apps/api`)
- `grid.service.test.ts`: each operator compiles to the expected **parameterized** fragment with
  **no raw value interpolation**; `contains` puts wildcards in the *param*; `in` uses `= ANY`;
  unknown column/operator/type-mismatch → 400; the count query gets the same `WHERE`; an empty
  filter is a no-op (identical to today's query).

## Frontend (`apps/web`)

### Data layer
- Extend the rows fetch (`apps/web/src/api/…rows`) to pass the active `RowFilter`; changing the
  filter resets the Infinite Row Model datasource (re-fetch from offset 0).

### Filter UI (`TableView`)
- Enable the existing "Filter" button → a filter popover/panel: add a condition (column dropdown
  from metadata, operator dropdown filtered by column type, value input typed to the column), an
  `and`/`or` combinator, remove-condition, and a "clear all". Active-filter count shown on the
  button.
- Token-driven styling, works at ~360px as a bottom sheet on mobile (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- Building conditions produces the expected `RowFilter`; operator options change with column type;
  clearing resets the datasource; the filter count badge reflects active conditions.

## Verification

### Manual (demo target DB, port 5434)
1. Open `users`, filter `email contains '@'` → grid shows matching rows, paging still works.
2. Numeric `>=` on an `orders` amount; `in` on a status set; `isNull` on a nullable column — each
   returns correct rows.
3. Combine two conditions with `and` then `or` → results change accordingly.
4. Edit a cell in a filtered single-table view → still editable and persists (editability holds).
5. Clear filters → back to the full paged view.
6. Forge a filter naming a non-existent column → 400, nothing executed.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Free-text/raw `WHERE` entry (deliberately excluded — structured only, principle §2).
- Cross-column expressions, sub-selects, joins in the filter (single-table predicates only).
- Saved/named filters (could ride on Phase 13 snippets or Phase 19 later).
- Server-side sorting UI — separate concern from filtering; not in this slice.
