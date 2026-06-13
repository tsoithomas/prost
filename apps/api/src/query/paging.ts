export const QUERY_PAGE_SIZE = 100;

export interface PagedQuery {
  sql: string;
  params: unknown[];
}

/**
 * Wraps a single `SELECT` statement in a bound `LIMIT`/`OFFSET` window (architecture
 * principle §7). Requests one row more than `limit` so the caller can detect truncation
 * without a separate `COUNT(*)` — exact counts on arbitrary queries are never the default
 * path (principle §7).
 */
export function buildPagedQuery(sql: string, limit = QUERY_PAGE_SIZE, offset = 0): PagedQuery {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  return {
    sql: `SELECT * FROM (${trimmed}) AS __prost_query LIMIT $1 OFFSET $2`,
    params: [limit + 1, offset],
  };
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
