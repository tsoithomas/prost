import type { MaskedColumns } from '@prost/shared-types';
import { MASK_TOKEN } from '@prost/shared-types';

/**
 * Column masking (Phase 39) — a **display/export transform, not access control**. The server redacts
 * these columns before rows leave the seam so a shared screen or a handed-over CSV can't leak them
 * incidentally; the same user can reveal them, and query results are never masked.
 *
 * Pure functions: the preference in, redacted rows out. No Nest, no driver, no DB.
 */

/** The preference key for one table — `"schema.table"`, matching `ColumnRenderOverrides`. */
export function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

/**
 * The columns masked for one table on one connection. Returns an empty set when nothing is masked,
 * so callers can skip redaction entirely without a null check.
 *
 * **Primary-key columns are never masked.** A PK is not just displayed — the client uses its row
 * values as the row's identity in the grid and as the locator for every update/delete and FK
 * navigation. Redacting it would give every row the same identity and point every write at a row
 * that doesn't exist. Masking is a display transform; it must not break row targeting, so a PK in
 * the preference is ignored here rather than honored.
 */
export function maskedColumnsFor(
  masked: MaskedColumns | undefined,
  connectionId: string,
  schema: string,
  table: string,
  primaryKey: readonly string[] = [],
): Set<string> {
  const configured = masked?.[connectionId]?.[tableKey(schema, table)] ?? [];
  const pk = new Set(primaryKey);
  return new Set(configured.filter((column) => !pk.has(column)));
}

/** Redact one value: `null` stays `null` — a mask must not invent data that isn't there. */
export function redactValue(value: unknown): unknown {
  return value === null || value === undefined ? value : MASK_TOKEN;
}

/**
 * Replace every masked column's value with the mask token. Rows are copied, never mutated in place,
 * and columns the row doesn't carry are left alone (a projection may not include them).
 */
export function redactRows<T extends Record<string, unknown>>(
  rows: T[],
  masked: Set<string>,
): Record<string, unknown>[] {
  if (masked.size === 0) return rows;
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const column of masked) {
      if (column in out) out[column] = redactValue(out[column]);
    }
    return out;
  });
}

export { MASK_TOKEN };
