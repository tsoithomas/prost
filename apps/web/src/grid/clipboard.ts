/**
 * Row-copy helpers shared by the grid's keyboard shortcut (`copy-cells`) and its cell context menu
 * (Phase 40) — one implementation of "what does copying a row mean" for both entry points.
 */

/** Tab-separated rows (with a header line of column names) — pastes cleanly into a spreadsheet. */
export function rowsToTsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join('\t')];
  for (const row of rows) lines.push(columns.map((c) => String(row[c] ?? '')).join('\t'));
  return lines.join('\n');
}

/** A single row as pretty-printed JSON, restricted to the given column names. */
export function rowToJson(row: Record<string, unknown>, columns: string[]): string {
  const picked: Record<string, unknown> = {};
  for (const c of columns) picked[c] = row[c];
  return JSON.stringify(picked, null, 2);
}
