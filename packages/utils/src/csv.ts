/**
 * Framework-free RFC 4180 CSV formatting helpers, shared by the export service (and usable by any
 * client-side formatting). Values are serialized cell-by-cell; the caller owns row iteration so an
 * exporter can stream one row at a time without buffering the whole result.
 */

export interface CsvFormatOptions {
  /** Field delimiter. Defaults to a comma. */
  delimiter?: string;
  /**
   * How a SQL `null` is rendered. Default `null` → an empty *unquoted* field, which keeps NULL
   * distinguishable from an empty string (`''` renders as a quoted empty field `""`). Set a token
   * (e.g. `\\N` or `NULL`) to make nulls explicit instead.
   */
  nullToken?: string | null;
}

const DEFAULT_DELIMITER = ',';
/** RFC 4180 mandates CRLF between records. */
export const CSV_ROW_TERMINATOR = '\r\n';

/**
 * Escapes a single value into an RFC 4180 field. A field is wrapped in double quotes when it contains
 * the delimiter, a double quote, CR, or LF; embedded double quotes are doubled. `null`/`undefined`
 * follow `nullToken` (default: an empty, *unquoted* field). Empty string is always emitted as a quoted
 * empty field so it stays distinct from NULL. Numbers/booleans/bigints stringify directly; objects
 * (e.g. JSON columns, Dates) are JSON-stringified.
 */
export function csvEscape(value: unknown, options: CsvFormatOptions = {}): string {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;

  if (value === null || value === undefined) {
    const token = options.nullToken ?? null;
    return token === null ? '' : escapeField(token, delimiter);
  }

  if (value === '') return '""';

  const text =
    typeof value === 'object' ? JSON.stringify(value) : typeof value === 'string' ? value : String(value);

  return escapeField(text, delimiter);
}

function escapeField(text: string, delimiter: string): string {
  const mustQuote =
    text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r');
  const escaped = text.replace(/"/g, '""');
  return mustQuote ? `"${escaped}"` : escaped;
}

/**
 * Formats one CSV record (no trailing terminator — the caller joins rows with `CSV_ROW_TERMINATOR`).
 * Use for both the header row (an array of column names) and data rows.
 */
export function formatCsvRow(values: readonly unknown[], options: CsvFormatOptions = {}): string {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
  return values.map((value) => csvEscape(value, options)).join(delimiter);
}
