/**
 * Server-side editability analyzer (architecture principle §4, spec §6.7).
 *
 * The shapes below describe only the slice of `node-sql-parser`'s AST this module reads,
 * verified against the installed `node-sql-parser@5.4.0` output for the spec's example
 * queries — the package's bundled `.d.ts` is stale for several of these fields (e.g.
 * `distinct`), so we deliberately don't import its types.
 */
export interface ParsedStatement {
  type: string;
  [key: string]: unknown;
}

interface ParsedTableRef {
  db: string | null;
  table?: string;
  join?: string;
  [key: string]: unknown;
}

interface ParsedColumn {
  expr: { type?: string; column?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

interface ParsedSelect extends ParsedStatement {
  type: 'select';
  with: unknown[] | null;
  distinct: { type: string | null } | null;
  columns: ParsedColumn[];
  from: ParsedTableRef[] | null;
  groupby: unknown;
}

export interface SingleTableRef {
  schema: string;
  table: string;
}

export interface EditabilityResult {
  editable: boolean;
  sourceTable?: string;
  primaryKey?: string[];
}

const READ_ONLY: EditabilityResult = { editable: false };

function isSelect(statement: ParsedStatement): statement is ParsedSelect {
  return statement.type === 'select';
}

/**
 * Returns true if `node` (anywhere in an AST subtree) contains a nested SELECT — i.e. a
 * subquery. Used to reject WHERE-clause subqueries that `extractSingleTable` would otherwise
 * miss because they don't affect the top-level `from` array.
 */
function containsSubquery(node: unknown): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if ((node as Record<string, unknown>)['type'] === 'select') return true;
  const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  return children.some(containsSubquery);
}

/**
 * If `statements` is exactly one `SELECT` against exactly one base table (no join, no
 * subquery, no CTE, no set operation), returns its schema/table so the caller can resolve
 * the table's primary key via `MetadataService`. Returns `null` for anything else — joins,
 * subqueries, CTEs, UNION/INTERSECT/EXCEPT, multi-statement input, or non-`SELECT` statements
 * are never editable, so there's no need to look up a table at all.
 */
export function extractSingleTable(
  statements: ParsedStatement[],
  defaultSchema = 'public',
): SingleTableRef | null {
  if (statements.length !== 1) return null;
  const [statement] = statements;
  if (!statement || !isSelect(statement)) return null;
  if (statement.with && statement.with.length > 0) return null;

  // UNION / INTERSECT / EXCEPT: node-sql-parser chains these via `_next` on the outer SELECT.
  if ((statement as Record<string, unknown>)['_next'] != null) return null;

  const from = statement.from;
  if (!Array.isArray(from) || from.length !== 1) return null;

  const [ref] = from;
  if (!ref || ref.join || typeof ref.table !== 'string') return null;

  // Subqueries in WHERE make the result non-updatable even when FROM is a single table.
  if (containsSubquery((statement as Record<string, unknown>)['where'])) return null;

  return { schema: ref.db ?? defaultSchema, table: ref.table };
}

function isStarColumn(column: ParsedColumn): boolean {
  const { expr } = column;
  return expr.type === 'column_ref' && expr.column === '*';
}

function projectsEverything(columns: ParsedColumn[]): boolean {
  return columns.length === 1 && isStarColumn(columns[0]!);
}

function columnRefName(expr: ParsedColumn['expr']): string | null {
  if (expr.type !== 'column_ref') return null;
  const { column } = expr;
  if (typeof column === 'string') return column === '*' ? null : column;
  if (typeof column === 'object' && column !== null) {
    const value = (column as { expr?: { value?: unknown } }).expr?.value;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function projectsAllOf(names: string[], columns: ParsedColumn[]): boolean {
  const projected = new Set<string>();
  for (const column of columns) {
    const name = columnRefName(column.expr);
    if (name) projected.add(name);
  }
  return names.every((name) => projected.has(name));
}

function hasAggregate(columns: ParsedColumn[]): boolean {
  return columns.some((column) => column.expr.type === 'aggr_func');
}

/**
 * Per spec §6.7: a result is editable only when the statement is a single `SELECT` against
 * exactly one table, with no joins, no `DISTINCT`/`GROUP BY`/aggregates, and the table's
 * primary-key column(s) are present in the projection. `table` and `primaryKey` are resolved
 * by the caller (via `extractSingleTable` + `MetadataService`) — this function makes the
 * final, defensive pass and is the single source of truth for the decision.
 */
export function analyzeEditability(
  statements: ParsedStatement[],
  table: SingleTableRef,
  primaryKey: string[],
): EditabilityResult {
  if (primaryKey.length === 0) return READ_ONLY;
  if (statements.length !== 1) return READ_ONLY;

  const [statement] = statements;
  if (!statement || !isSelect(statement)) return READ_ONLY;
  if (statement.distinct?.type) return READ_ONLY;
  if (statement.groupby) return READ_ONLY;

  const columns = statement.columns;
  if (hasAggregate(columns)) return READ_ONLY;
  if (!projectsEverything(columns) && !projectsAllOf(primaryKey, columns)) return READ_ONLY;

  return { editable: true, sourceTable: `${table.schema}.${table.table}`, primaryKey };
}
