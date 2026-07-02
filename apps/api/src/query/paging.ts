export const QUERY_PAGE_SIZE = 100;

export interface PagedQuery {
  sql: string;
  params: unknown[];
}

/**
 * An optional sort applied to the *outer* wrapper (never the user's SQL text). `column` is an output
 * column name of the inner result; it's emitted through `quoteIdent` so it can never be raw-concatenated
 * SQL (architecture principle §1). The client only ever sends a column that came from the rendered
 * grid, so it's always a real output column.
 */
export interface QueryOrderBy {
  column: string;
  dir: 'asc' | 'desc';
  quoteIdent: (identifier: string) => string;
}

function orderByClause(orderBy: QueryOrderBy | undefined): string {
  if (!orderBy) return '';
  return ` ORDER BY ${orderBy.quoteIdent(orderBy.column)} ${orderBy.dir === 'desc' ? 'DESC' : 'ASC'}`;
}

/**
 * Wraps a single `SELECT` statement in a bound `LIMIT`/`OFFSET` window (architecture
 * principle §7). Requests one row more than `limit` so the caller can detect truncation
 * without a separate `COUNT(*)` — exact counts on arbitrary queries are never the default
 * path (principle §7). `placeholder` is the driver's positional placeholder (PG `$n`, SQLite `?`).
 * An optional `orderBy` sorts the full result (on the outer wrapper) before the window is applied.
 */
export function buildPagedQuery(
  sql: string,
  placeholder: (index: number) => string = (i) => `$${i}`,
  limit = QUERY_PAGE_SIZE,
  offset = 0,
  orderBy?: QueryOrderBy,
): PagedQuery {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  return {
    sql: `SELECT * FROM (${trimmed}) AS __prost_query${orderByClause(orderBy)} LIMIT ${placeholder(1)} OFFSET ${placeholder(2)}`,
    params: [limit + 1, offset],
  };
}

/**
 * Wraps a single `SELECT` in an `ORDER BY`-only subquery for the forward-only cursor path (which
 * applies its own row budget instead of `LIMIT`/`OFFSET`). Sorting a streamed result must be baked
 * into the statement at cursor-open time — a held cursor can't be re-sorted mid-stream.
 */
export function buildOrderedStatement(sql: string, orderBy: QueryOrderBy): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  return `SELECT * FROM (${trimmed}) AS __prost_query${orderByClause(orderBy)}`;
}

const SELECT_PREFIX = /^\s*select\b/i;

/**
 * Heuristic used when `node-sql-parser` fails to classify the statement (e.g. Postgres-only
 * syntax it doesn't support). A single statement that lexically starts with `SELECT` is
 * worth attempting to page via `buildPagedQuery` before falling back to an unbounded
 * execution (principle §7) — anything containing a `;` other than a single trailing one
 * isn't a single statement, so it's left to the unbounded fallback.
 */
export function looksLikeSingleSelect(sql: string): boolean {
  if (!SELECT_PREFIX.test(sql)) return false;
  const withoutTrailingSemicolon = sql.trim().replace(/;\s*$/, '');
  return !withoutTrailingSemicolon.includes(';');
}
