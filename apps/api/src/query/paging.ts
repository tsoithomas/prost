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
