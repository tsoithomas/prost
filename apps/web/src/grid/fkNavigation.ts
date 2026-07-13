import type { ForeignKeyMetadata, ReferencingKeyMetadata, RowFilter } from '@prost/shared-types';

/** A relational-navigation target derived from a clicked grid cell + the table's FK metadata. */
export interface FkNavTarget {
  direction: 'forward' | 'reverse';
  label: string;
  /** Schema of the table to open (falls back to the current schema where the engine has none). */
  schema: string;
  table: string;
  /** Parameterized `and`/`eq` filter to seed the opened table with (Phase 14 `RowFilter`). */
  filter: RowFilter;
}

/**
 * Given a clicked cell (`colId` + its `row`), builds the FK navigation targets:
 * - **forward** ("open referenced row") for each outgoing FK whose local columns include `colId`,
 * - **reverse** ("show referencing rows") for every table that references this row.
 *
 * A target is offered only when *every* FK column value is present in the row projection and
 * non-null (mirrors the editability PK rule) — so composite keys are first-class and a
 * partially-projected row hides the action.
 */
export function buildFkNavTargets(
  colId: string,
  row: Record<string, unknown>,
  foreignKeys: ForeignKeyMetadata[],
  referencingKeys: ReferencingKeyMetadata[],
  currentSchema: string,
): FkNavTarget[] {
  const targets: FkNavTarget[] = [];

  for (const fk of foreignKeys) {
    if (!fk.columns.includes(colId) || !fk.columns.every((c) => c in row)) continue;
    const values = fk.columns.map((c) => row[c]);
    if (values.some((v) => v === null || v === undefined)) continue;
    targets.push({
      direction: 'forward',
      label: `Open referenced row in ${fk.referencedTable}`,
      schema: fk.referencedSchema ?? currentSchema,
      table: fk.referencedTable,
      filter: {
        combinator: 'and',
        conditions: fk.referencedColumns.map((rc, i) => ({ column: rc, operator: 'eq', value: values[i] })),
      },
    });
  }

  for (const rk of referencingKeys) {
    if (!rk.referencedColumns.every((c) => c in row)) continue;
    const values = rk.referencedColumns.map((c) => row[c]);
    if (values.some((v) => v === null || v === undefined)) continue;
    targets.push({
      direction: 'reverse',
      label: `Show referencing rows in ${rk.table}`,
      schema: rk.schema ?? currentSchema,
      table: rk.table,
      filter: {
        combinator: 'and',
        conditions: rk.columns.map((c, i) => ({ column: c, operator: 'eq', value: values[i] })),
      },
    });
  }

  return targets;
}
