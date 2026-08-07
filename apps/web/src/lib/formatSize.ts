/** Formats a byte count into a compact human string; `null` renders as an em dash. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

/**
 * Formats a row count. Engines report these as estimates off the catalog (PG `reltuples`, MySQL
 * `TABLE_ROWS`), so the `~` is part of the contract — never present one as exact.
 */
export function formatRows(rows: number | null): string {
  return rows === null ? '—' : `~${rows.toLocaleString()}`;
}
