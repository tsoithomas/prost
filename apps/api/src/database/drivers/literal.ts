import type { ColumnMetadata } from '@prost/shared-types';

/**
 * Dialect-specific pieces of SQL value-literal formatting (Phase 30.1 SQL export). Values are rendered
 * as inline literals for `INSERT … VALUES (…)` — the export is a `.sql` file, so it can't parameterize.
 * Every code path that WRITES to a live DB still binds params; this is output-only formatting.
 */
export interface LiteralDialect {
  /** Boolean literal: PG `TRUE`/`FALSE`; MySQL/SQLite `1`/`0`. */
  bool: (value: boolean) => string;
  /** Binary literal from lowercase hex: PG `'\xHEX'` (bytea); MySQL/SQLite `X'HEX'`. */
  bytes: (hex: string) => string;
  /** A fully-quoted string literal (including the surrounding quotes and all escaping). */
  quoteString: (value: string) => string;
}

/**
 * Formats one JS value as a SQL literal for the given dialect. Dispatches on the runtime type (which
 * the drivers hand back already typed — pg returns `Buffer` for bytea, `Date` for timestamps, objects
 * for json, booleans for bool); `column` is available as a hint but isn't needed for the common types.
 */
export function formatLiteral(value: unknown, _column: ColumnMetadata, d: LiteralDialect): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return d.bool(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (value instanceof Date) return d.quoteString(value.toISOString());
  if (value instanceof Uint8Array) return d.bytes(Buffer.from(value).toString('hex'));
  if (typeof value === 'object') return d.quoteString(JSON.stringify(value));
  return d.quoteString(String(value));
}

/** Standard SQL string literal: single-quote wrapped, embedded `'` doubled (PG under
 *  standard_conforming_strings, and SQLite). Backslash is a literal in both. */
export function standardQuoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** MySQL string literal: backslash is an escape char by default, so escape `\` and the control set too. */
export function mysqlQuoteString(value: string): string {
  // The control chars (\0, \n, \r, \x1a/Ctrl-Z) are deliberate — MySQL requires them backslash-escaped.
  // eslint-disable-next-line no-control-regex
  const escaped = value.replace(/[\\'\0\n\r\x1a]/g, (ch) => {
    switch (ch) {
      case '\\': return '\\\\';
      case "'": return "\\'";
      case '\0': return '\\0';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\x1a': return '\\Z';
      default: return ch;
    }
  });
  return `'${escaped}'`;
}
