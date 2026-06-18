import { useCallback, useMemo, useState } from 'react';
import type { BulkRowEdit, BulkRowUpdateBody, RowConcurrency } from '@prost/shared-types';

/** One row's staged (uncommitted) edits, plus what we need to guard the eventual write. */
export interface RowEditEntry {
  primaryKey: Record<string, unknown>;
  /** token-mode guard: the `__version` read with the row. */
  version?: string;
  /** Pre-edit values of the columns in `edits` (for the preimage guard and for undo). */
  original: Record<string, unknown>;
  /** column → new value. */
  edits: Record<string, unknown>;
}

export interface RowIdentity {
  primaryKey: Record<string, unknown>;
  version?: string;
}

/**
 * Builds a single row's `BulkRowEdit` (PK, edits, and the concurrency guard for the active engine).
 * Shared by the staged-save path and the undo/redo compensating writes.
 */
export function buildRowEdit(
  entry: RowEditEntry,
  concurrency: RowConcurrency,
): BulkRowEdit {
  const edits = Object.entries(entry.edits).map(([column, value]) => ({ column, value }));
  if (concurrency === 'token') {
    return { primaryKey: entry.primaryKey, edits, version: entry.version };
  }
  const expected: Record<string, unknown> = {};
  for (const column of Object.keys(entry.edits)) expected[column] = entry.original[column];
  return { primaryKey: entry.primaryKey, edits, expected };
}

/**
 * Accumulates staged cell edits keyed by row, so a multi-cell / multi-row change flushes as one
 * transactional `BulkRowUpdateBody`. An edit back to a row's original value drops out of the
 * buffer (no-op), and a row with no remaining edits is removed entirely.
 */
export function useEditBuffer() {
  const [buffer, setBuffer] = useState<Record<string, RowEditEntry>>({});

  const stage = useCallback((rowKey: string, identity: RowIdentity, column: string, oldValue: unknown, newValue: unknown) => {
    setBuffer((prev) => {
      const existing = prev[rowKey];
      const original = { ...(existing?.original ?? {}) };
      const edits = { ...(existing?.edits ?? {}) };
      // Capture the load-time value the first time a column is touched.
      if (!(column in original)) original[column] = oldValue;
      if (newValue === original[column]) {
        delete edits[column];
        delete original[column];
      } else {
        edits[column] = newValue;
      }
      if (Object.keys(edits).length === 0) {
        const rest = { ...prev };
        delete rest[rowKey];
        return rest;
      }
      return {
        ...prev,
        [rowKey]: { primaryKey: identity.primaryKey, version: identity.version, original, edits },
      };
    });
  }, []);

  const clear = useCallback(() => setBuffer({}), []);

  const dirtyCells = useMemo(
    () => Object.values(buffer).reduce((sum, entry) => sum + Object.keys(entry.edits).length, 0),
    [buffer],
  );

  /** `rowKey → set of edited columns`, for dirty-cell styling. */
  const dirtyColumns = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const [rowKey, entry] of Object.entries(buffer)) map[rowKey] = new Set(Object.keys(entry.edits));
    return map;
  }, [buffer]);

  const buildBody = useCallback(
    (concurrency: RowConcurrency): BulkRowUpdateBody => ({
      rows: Object.values(buffer).map((entry) => buildRowEdit(entry, concurrency)),
    }),
    [buffer],
  );

  return { buffer, stage, clear, dirtyCells, dirtyColumns, buildBody };
}
