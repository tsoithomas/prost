import type { ProfileColumnSpec, ProfileSamplePlan, SqlFragment, TableRef } from '../types';

/**
 * Shared column-profiling SQL (Phase 37). The three engines differ only in quoting, text casting,
 * placeholders, and how a scan is bounded, so the aggregate shape lives here once and each driver
 * supplies its dialect — same split as `fk-ddl.ts`.
 */
export interface ProfileDialect {
  quoteIdent(identifier: string): string;
  /** The quoted, qualified table name. */
  qualify(ref: TableRef): string;
  /** 1-based positional placeholder (PG `$1`, MySQL/SQLite `?`). */
  placeholder(index: number): string;
  /** Wrap an expression so it comes back as text: PG `(x)::text`, MySQL `CAST(x AS CHAR)`. */
  castText(expression: string): string;
  /**
   * The `FROM` clause for a plan, plus any params it binds. `projection` is the column list a
   * `firstRows` subquery should carry (`*` for the profile, one column for top-values).
   */
  from(ref: TableRef, plan: ProfileSamplePlan, projection: string, firstParamIndex: number): { sql: string; params: unknown[] };
}

/** Rows a sampled profile aims to scan. Tables smaller than this are never sampled. */
export const PROFILE_SAMPLE_TARGET_ROWS = 50_000;

/**
 * Aggregates cost one result column each, and engines cap how wide a result row can be (PG at
 * 1664), so a very wide table profiles its first `PROFILE_MAX_COLUMNS` columns and reports the rest
 * as omitted rather than failing with a cryptic engine error.
 */
export const PROFILE_MAX_COLUMNS = 200;

/** Default number of buckets in a column's top-N distribution. */
export const PROFILE_TOP_VALUES_LIMIT = 10;

/** The `firstRows` plan shared by engines without native random sampling (MySQL, SQLite). */
export function planLimitSample(rowEstimate: number, exact: boolean): ProfileSamplePlan {
  if (exact || rowEstimate <= PROFILE_SAMPLE_TARGET_ROWS) return { kind: 'full' };
  return { kind: 'firstRows', limit: PROFILE_SAMPLE_TARGET_ROWS };
}

/** Per-column aliases in a profile result row. */
export function profileAlias(index: number, part: 'nulls' | 'distinct' | 'min' | 'max'): string {
  return `c${index}_${part}`;
}

/**
 * One-pass profile: a single row of `scanned_rows` plus four aggregates per column. Non-orderable
 * columns (json/xml/array/binary) emit literal `NULL`s — those types have no engine-wide equality
 * or ordering, so `COUNT(DISTINCT)`/`MIN`/`MAX` would fail outright.
 */
export function buildProfileSql(
  dialect: ProfileDialect,
  ref: TableRef,
  columns: ProfileColumnSpec[],
  plan: ProfileSamplePlan,
): SqlFragment {
  const selections = ['COUNT(*) AS scanned_rows'];

  columns.forEach((column, i) => {
    const quoted = dialect.quoteIdent(column.name);
    selections.push(`COUNT(*) - COUNT(${quoted}) AS ${profileAlias(i, 'nulls')}`);
    if (column.orderable) {
      selections.push(`COUNT(DISTINCT ${quoted}) AS ${profileAlias(i, 'distinct')}`);
      selections.push(`${dialect.castText(`MIN(${quoted})`)} AS ${profileAlias(i, 'min')}`);
      selections.push(`${dialect.castText(`MAX(${quoted})`)} AS ${profileAlias(i, 'max')}`);
    } else {
      selections.push(`NULL AS ${profileAlias(i, 'distinct')}`);
      selections.push(`NULL AS ${profileAlias(i, 'min')}`);
      selections.push(`NULL AS ${profileAlias(i, 'max')}`);
    }
  });

  const from = dialect.from(ref, plan, '*', 1);
  return { sql: `SELECT ${selections.join(', ')} ${from.sql}`, params: from.params };
}

/**
 * The most common values of one column, aliased `value, occurrences`, most frequent first.
 * `scanned_rows` (the same total on every row) comes from a window over the groups, so the caller
 * can compute each value's share without a second scan. Window functions are available on all three
 * supported engines (PG, MySQL 8.0+, SQLite 3.25+).
 */
export function buildTopValuesSql(
  dialect: ProfileDialect,
  ref: TableRef,
  column: string,
  plan: ProfileSamplePlan,
  limit: number,
): SqlFragment {
  const quoted = dialect.quoteIdent(column);
  const from = dialect.from(ref, plan, quoted, 1);
  return {
    sql:
      `SELECT ${dialect.castText(quoted)} AS value, COUNT(*) AS occurrences, ` +
      `SUM(COUNT(*)) OVER () AS scanned_rows ` +
      `${from.sql} GROUP BY ${quoted} ORDER BY occurrences DESC, 1 ` +
      `LIMIT ${dialect.placeholder(from.params.length + 1)}`,
    params: [...from.params, limit],
  };
}
