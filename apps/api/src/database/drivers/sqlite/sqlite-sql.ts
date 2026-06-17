import { quoteIdent } from '@prost/utils';
import type { AlterTableOperation, CreateIndexRequest, CreateTableRequest } from '@prost/shared-types';
import type { SelectRowsOptions, SqlFragment, TableRef } from '../../types';

/** SQLite accepts double-quoted identifiers, with embedded quotes doubled — same as PG. */
export const sqliteQuoteIdent = quoteIdent;
/** SQLite uses positional `?` placeholders; the 1-based index is irrelevant to the wire form. */
export const sqlitePlaceholder = (_index: number): string => '?';

/** SQLite presents a single database as the `main` schema; qualify only when a namespace is given. */
function qualify(ref: TableRef): string {
  const table = sqliteQuoteIdent(ref.name);
  return ref.namespace ? `${sqliteQuoteIdent(ref.namespace)}.${table}` : table;
}

export function sqliteBuildListTables(): SqlFragment {
  return {
    sql: `SELECT 'main' AS table_schema, name AS table_name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
    params: [],
  };
}

export function sqliteBuildListAllColumns(): SqlFragment {
  return {
    sql: `SELECT 'main' AS table_schema, m.name AS table_name, ti.name AS column_name,
           ti.type AS data_type,
           CASE WHEN ti."notnull" = 0 THEN 'YES' ELSE 'NO' END AS is_nullable,
           CASE WHEN ti.pk > 0 THEN 1 ELSE 0 END AS is_primary_key
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) ti
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
         ORDER BY m.name, ti.cid`,
    params: [],
  };
}

export function sqliteBuildListColumns(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT name AS column_name, type AS data_type,
           CASE WHEN "notnull" = 0 THEN 'YES' ELSE 'NO' END AS is_nullable,
           CASE WHEN pk > 0 THEN 1 ELSE 0 END AS is_primary_key
         FROM pragma_table_info(?)
         ORDER BY cid`,
    params: [ref.name],
  };
}

/** `columns` comes back as a JSON-encoded array (SQLite has no array type); consumers parse it. */
export function sqliteBuildListIndexes(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT il.name AS name,
           il."unique" AS is_unique,
           CASE WHEN il.origin = 'pk' THEN 1 ELSE 0 END AS is_primary,
           'btree' AS method,
           '' AS definition,
           (SELECT json_group_array(ii.name)
            FROM pragma_index_info(il.name) ii) AS columns
         FROM pragma_index_list(?) il
         ORDER BY is_primary DESC, il.name`,
    params: [ref.name],
  };
}

export function sqliteBuildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment {
  let sql = `SELECT * FROM ${qualify(ref)}`;
  if (opts.whereClause) sql += ` ${opts.whereClause}`;
  if (opts.orderColumn) sql += ` ORDER BY ${sqliteQuoteIdent(opts.orderColumn)} ${opts.sortDir}`;
  sql += ` LIMIT ? OFFSET ?`;
  return { sql, params: [...opts.whereParams, opts.limit, opts.offset] };
}

export function sqliteBuildFilteredRowCount(ref: TableRef, whereClause: string, whereParams: unknown[]): SqlFragment {
  return { sql: `SELECT COUNT(*) AS count FROM ${qualify(ref)} ${whereClause}`, params: whereParams };
}

/** SQLite has no cheap statistics estimate; alias an exact COUNT(*) as `reltuples` so the grid reads it unchanged. */
export function sqliteBuildRowCountEstimate(ref: TableRef): SqlFragment {
  return { sql: `SELECT COUNT(*) AS reltuples FROM ${qualify(ref)}`, params: [] };
}

export function sqliteBuildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment {
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${qualify(ref)} DEFAULT VALUES RETURNING *`, params: [] };
  }
  const cols = entries.map(([c]) => sqliteQuoteIdent(c)).join(', ');
  const vals = entries.map(() => '?').join(', ');
  return { sql: `INSERT INTO ${qualify(ref)} (${cols}) VALUES (${vals}) RETURNING *`, params: entries.map(([, v]) => v) };
}

export function sqliteBuildUpdateRow(ref: TableRef, column: string, value: unknown, pkColumns: string[], pkValues: unknown[]): SqlFragment {
  const setClause = `${sqliteQuoteIdent(column)} = ?`;
  const whereClause = pkColumns.map((c) => `${sqliteQuoteIdent(c)} = ?`).join(' AND ');
  return { sql: `UPDATE ${qualify(ref)} SET ${setClause} WHERE ${whereClause} RETURNING *`, params: [value, ...pkValues] };
}

export function sqliteBuildDeleteRow(ref: TableRef, pkColumns: string[], pkValues: unknown[]): SqlFragment {
  const whereClause = pkColumns.map((c) => `${sqliteQuoteIdent(c)} = ?`).join(' AND ');
  return { sql: `DELETE FROM ${qualify(ref)} WHERE ${whereClause}`, params: pkValues };
}

export function sqliteBuildCreateTable(req: CreateTableRequest): SqlFragment {
  const pkColumns = req.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const colDefs = req.columns.map((col) => {
    let def = `  ${sqliteQuoteIdent(col.name)} ${col.type}`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default.trim()}`;
    return def;
  });
  if (pkColumns.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkColumns.map(sqliteQuoteIdent).join(', ')})`);
  }
  const target = qualify({ namespace: req.schema, name: req.table });
  return { sql: `CREATE TABLE ${target} (\n${colDefs.join(',\n')}\n)`, params: [] };
}

/**
 * SQLite's ALTER TABLE only supports ADD/DROP COLUMN; retyping, NOT NULL toggles, and default
 * changes require a table rebuild and are unsupported here (DDL for SQLite is out of scope —
 * the SQLite connection is for inspection).
 */
export function sqliteBuildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment {
  const prefix = `ALTER TABLE ${qualify(ref)}`;
  switch (op.kind) {
    case 'addColumn': {
      const col = op.column;
      let def = `${sqliteQuoteIdent(col.name)} ${col.type}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default}`;
      return { sql: `${prefix} ADD COLUMN ${def}`, params: [] };
    }
    case 'dropColumn':
      return { sql: `${prefix} DROP COLUMN ${sqliteQuoteIdent(op.column)}`, params: [] };
    case 'setNotNull':
    case 'setDefault':
    case 'changeType':
      throw new Error(`SQLite does not support the "${op.kind}" alter-table operation`);
  }
}

/**
 * SQLite qualifies the *index name* with the schema, not the target table — the table must be
 * referenced bare and live in the same schema (`CREATE INDEX [schema.]name ON table (...)`).
 */
export function sqliteBuildCreateIndex(req: CreateIndexRequest, name: string, _method: string): SqlFragment {
  const colList = req.columns.map(sqliteQuoteIdent).join(', ');
  const indexName = req.schema
    ? `${sqliteQuoteIdent(req.schema)}.${sqliteQuoteIdent(name)}`
    : sqliteQuoteIdent(name);
  return {
    sql: `CREATE ${req.unique ? 'UNIQUE ' : ''}INDEX ${indexName} ON ${sqliteQuoteIdent(req.table)} (${colList})`,
    params: [],
  };
}

/** `ref.name` is the index name, `ref.namespace` the schema. */
export function sqliteBuildDropIndex(ref: TableRef, indexName: string): SqlFragment {
  const qualified = ref.namespace
    ? `${sqliteQuoteIdent(ref.namespace)}.${sqliteQuoteIdent(indexName)}`
    : sqliteQuoteIdent(indexName);
  return { sql: `DROP INDEX ${qualified}`, params: [] };
}

/**
 * SQLite carries column type names on the prepared-statement metadata, so the query layer never
 * needs a catalog round-trip. This is a no-op query (returns no rows) to satisfy the interface.
 */
export function sqliteBuildResolveTypeNames(_oids: number[]): SqlFragment {
  return { sql: "SELECT 0 AS oid, '' AS typname WHERE 0 = 1", params: [] };
}

export { qualify as sqliteQualify };
