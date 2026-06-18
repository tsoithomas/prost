import { quoteIdent } from '@prost/utils';
import { ROW_VERSION_KEY } from '@prost/shared-types';
import type { AlterTableOperation, CreateIndexRequest, CreateTableRequest } from '@prost/shared-types';
import type { RowUpdateGuard, SelectRowsOptions, SqlFragment, TableRef } from '../../types';

export const pgQuoteIdent = quoteIdent;
export const pgPlaceholder = (index: number): string => `$${index}`;

/** PG: namespace = schema; default to `public` only where a single-table op needs it (callers pass it explicitly). */
function qualify(ref: TableRef): string {
  const table = pgQuoteIdent(ref.name);
  return ref.namespace ? `${pgQuoteIdent(ref.namespace)}.${table}` : table;
}

export function pgBuildListTables(): SqlFragment {
  return {
    sql: `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           AND table_schema NOT LIKE 'pg_toast%'
           AND table_type = 'BASE TABLE'
         ORDER BY table_schema, table_name`,
    params: [],
  };
}

export function pgBuildListAllColumns(): SqlFragment {
  return {
    sql: `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable,
           EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = c.table_schema
               AND tc.table_name = c.table_name
               AND kcu.column_name = c.column_name
           ) AS is_primary_key
         FROM information_schema.columns c
         WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
           AND c.table_schema NOT LIKE 'pg_toast%'
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    params: [],
  };
}

export function pgBuildListColumns(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         c.column_name,
         c.data_type,
         c.is_nullable,
         EXISTS (
           SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = c.table_schema
             AND tc.table_name = c.table_name
             AND kcu.column_name = c.column_name
         ) AS is_primary_key
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
    params: [ref.namespace, ref.name],
  };
}

export function pgBuildListIndexes(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         i.relname                       AS name,
         ix.indisunique                  AS is_unique,
         ix.indisprimary                 AS is_primary,
         am.amname                       AS method,
         pg_get_indexdef(ix.indexrelid)  AS definition,
         ARRAY(
           SELECT a.attname
           FROM   pg_attribute a
           WHERE  a.attrelid = t.oid
             AND  a.attnum   = ANY(ix.indkey)
           ORDER BY array_position(ix.indkey::int[], a.attnum)
         )::text[] AS columns
       FROM   pg_index     ix
       JOIN   pg_class     t  ON t.oid  = ix.indrelid
       JOIN   pg_class     i  ON i.oid  = ix.indexrelid
       JOIN   pg_namespace n  ON n.oid  = t.relnamespace
       JOIN   pg_am        am ON am.oid = i.relam
       WHERE  n.nspname = $1
         AND  t.relname = $2
       ORDER BY ix.indisprimary DESC, i.relname`,
    params: [ref.namespace, ref.name],
  };
}

/** Re-projects the row's `xmin` transaction id as the reserved `__version` token (text-cast for JSON safety). */
const PG_VERSION_PROJECTION = `, xmin::text AS ${pgQuoteIdent(ROW_VERSION_KEY)}`;

export function pgBuildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment {
  const limitParam = opts.whereParams.length + 1;
  const offsetParam = opts.whereParams.length + 2;
  let sql = `SELECT *${opts.includeVersion ? PG_VERSION_PROJECTION : ''} FROM ${qualify(ref)}`;
  if (opts.whereClause) sql += ` ${opts.whereClause}`;
  if (opts.orderColumn) sql += ` ORDER BY ${pgQuoteIdent(opts.orderColumn)} ${opts.sortDir}`;
  sql += ` LIMIT ${pgPlaceholder(limitParam)} OFFSET ${pgPlaceholder(offsetParam)}`;
  return { sql, params: [...opts.whereParams, opts.limit, opts.offset] };
}

export function pgBuildFilteredRowCount(ref: TableRef, whereClause: string, whereParams: unknown[]): SqlFragment {
  return { sql: `SELECT COUNT(*) AS count FROM ${qualify(ref)} ${whereClause}`, params: whereParams };
}

export function pgBuildRowCountEstimate(ref: TableRef): SqlFragment {
  return {
    sql: "SELECT reltuples FROM pg_class WHERE oid = to_regclass(format('%I.%I', $1::text, $2::text))",
    params: [ref.namespace, ref.name],
  };
}

export function pgBuildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment {
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${qualify(ref)} DEFAULT VALUES RETURNING *`, params: [] };
  }
  const cols = entries.map(([c]) => pgQuoteIdent(c)).join(', ');
  const vals = entries.map((_, i) => pgPlaceholder(i + 1)).join(', ');
  return { sql: `INSERT INTO ${qualify(ref)} (${cols}) VALUES (${vals}) RETURNING *`, params: entries.map(([, v]) => v) };
}

export function pgBuildUpdateRow(ref: TableRef, column: string, value: unknown, pkColumns: string[], pkValues: unknown[]): SqlFragment {
  const setClause = `${pgQuoteIdent(column)} = ${pgPlaceholder(1)}`;
  const whereClause = pkColumns.map((c, i) => `${pgQuoteIdent(c)} = ${pgPlaceholder(i + 2)}`).join(' AND ');
  return { sql: `UPDATE ${qualify(ref)} SET ${setClause} WHERE ${whereClause} RETURNING *`, params: [value, ...pkValues] };
}

export function pgBuildUpdateRowGuarded(
  ref: TableRef,
  edits: [string, unknown][],
  pkColumns: string[],
  pkValues: unknown[],
  guard: RowUpdateGuard,
): SqlFragment {
  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return pgPlaceholder(params.length);
  };

  const setClause = edits.map(([c, v]) => `${pgQuoteIdent(c)} = ${next(v)}`).join(', ');
  const where = pkColumns.map((c, i) => `${pgQuoteIdent(c)} = ${next(pkValues[i])}`);
  if (guard.kind === 'version') {
    where.push(`xmin = ${next(guard.value)}::xid`);
  } else {
    guard.columns.forEach((c, i) => where.push(`${pgQuoteIdent(c)} IS NOT DISTINCT FROM ${next(guard.values[i])}`));
  }

  return {
    sql: `UPDATE ${qualify(ref)} SET ${setClause} WHERE ${where.join(' AND ')} RETURNING *${PG_VERSION_PROJECTION}`,
    params,
  };
}

export function pgBuildDeleteRow(ref: TableRef, pkColumns: string[], pkValues: unknown[]): SqlFragment {
  const whereClause = pkColumns.map((c, i) => `${pgQuoteIdent(c)} = ${pgPlaceholder(i + 1)}`).join(' AND ');
  return { sql: `DELETE FROM ${qualify(ref)} WHERE ${whereClause}`, params: pkValues };
}

export function pgBuildCreateTable(req: CreateTableRequest): SqlFragment {
  const pkColumns = req.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const colDefs = req.columns.map((col) => {
    let def = `  ${pgQuoteIdent(col.name)} ${col.type}`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default.trim()}`;
    return def;
  });
  if (pkColumns.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkColumns.map(pgQuoteIdent).join(', ')})`);
  }
  return { sql: `CREATE TABLE ${pgQuoteIdent(req.schema)}.${pgQuoteIdent(req.table)} (\n${colDefs.join(',\n')}\n)`, params: [] };
}

export function pgBuildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment {
  const prefix = `ALTER TABLE ${qualify(ref)}`;
  switch (op.kind) {
    case 'addColumn': {
      const col = op.column;
      let def = `${pgQuoteIdent(col.name)} ${col.type}`;
      if (col.isPrimaryKey) def += ' PRIMARY KEY';
      else if (!col.nullable) def += ' NOT NULL';
      if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default}`;
      return { sql: `${prefix} ADD COLUMN ${def}`, params: [] };
    }
    case 'dropColumn':
      return { sql: `${prefix} DROP COLUMN ${pgQuoteIdent(op.column)}`, params: [] };
    case 'setNotNull':
      return { sql: `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} ${op.notNull ? 'SET' : 'DROP'} NOT NULL`, params: [] };
    case 'setDefault':
      return op.default !== null
        ? { sql: `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} SET DEFAULT ${op.default}`, params: [] }
        : { sql: `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} DROP DEFAULT`, params: [] };
    case 'changeType': {
      let sql = `${prefix} ALTER COLUMN ${pgQuoteIdent(op.column)} TYPE ${op.type}`;
      if (op.using) sql += ` USING ${op.using}`;
      return { sql, params: [] };
    }
  }
}

export function pgBuildCreateIndex(req: CreateIndexRequest, name: string, method: string): SqlFragment {
  const colList = req.columns.map(pgQuoteIdent).join(', ');
  return {
    sql: `CREATE ${req.unique ? 'UNIQUE ' : ''}INDEX ${pgQuoteIdent(name)} ON ${pgQuoteIdent(req.schema)}.${pgQuoteIdent(req.table)} USING ${method} (${colList})`,
    params: [],
  };
}

/** `ref.name` is the index name, `ref.namespace` the schema. */
export function pgBuildDropIndex(ref: TableRef, indexName: string): SqlFragment {
  return { sql: `DROP INDEX ${pgQuoteIdent(ref.namespace!)}.${pgQuoteIdent(indexName)}`, params: [] };
}

export function pgBuildResolveTypeNames(oids: number[]): SqlFragment {
  return { sql: 'SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])', params: [oids] };
}

export { qualify as pgQualify };
