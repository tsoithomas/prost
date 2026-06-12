/**
 * Quotes a Postgres identifier (table, column, schema name) for safe interpolation
 * into SQL that cannot use parameterized placeholders. Always double-quotes and
 * escapes embedded double quotes, so the result is safe regardless of the
 * identifier's contents.
 */
export function quoteIdent(identifier: string): string {
  if (identifier.length === 0) {
    throw new Error('Identifier must not be empty');
  }
  if (identifier.includes('\u0000')) {
    throw new Error('Identifier must not contain null bytes');
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}
