import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import type {
  AlterTableOperation,
  ColumnMetadata,
  CreateIndexRequest,
  CreateTableRequest,
  NewColumn,
  SchemaObjectKind,
} from '@prost/shared-types';
import type { RowUpdateGuard, SelectRowsOptions, SqlFragment, TableRef } from '../../types';

const SAFE_DEFAULT_PATTERN = /^(\d+|true|false|null|now\(\)|current_timestamp|gen_random_uuid\(\))$/i;

function validateType(type: string, columnTypes: string[]): string {
  const canonical = columnTypes.find((candidate) => candidate.toLowerCase() === type.trim().toLowerCase());
  if (!canonical) {
    throw new UnprocessableEntityException(
      `Unsupported column type "${type}". Allowed types: ${columnTypes.join(', ')}`,
    );
  }
  return canonical;
}

function validateDefault(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!SAFE_DEFAULT_PATTERN.test(trimmed)) {
    throw new UnprocessableEntityException(
      `Unsupported default value "${value}". Allowed: now(), current_timestamp, gen_random_uuid(), true, false, null, or a non-negative integer`,
    );
  }
  return trimmed;
}

function normalizeColumn(col: NewColumn, columnTypes: string[]): NewColumn {
  const type = validateType(col.type, columnTypes);
  const canonicalDefault = validateDefault(col.default);
  return {
    name: col.name,
    type,
    nullable: col.nullable,
    isPrimaryKey: col.isPrimaryKey,
    ...(canonicalDefault !== null ? { default: canonicalDefault } : {}),
  };
}

export function sqliteNormalizeCreateTable(
  req: CreateTableRequest,
  columnTypes: string[],
): CreateTableRequest {
  return {
    schema: req.schema,
    table: req.table,
    columns: req.columns.map((column) => normalizeColumn(column, columnTypes)),
  };
}

export function sqliteNormalizeAlterTable(
  _ref: TableRef,
  op: AlterTableOperation,
  columns: ColumnMetadata[],
  columnTypes: string[],
): AlterTableOperation {
  const colNames = new Set(columns.map((column) => column.name));

  switch (op.kind) {
    case 'addColumn': {
      if (colNames.has(op.column.name)) {
        throw new ConflictException(`Column "${op.column.name}" already exists`);
      }
      const type = validateType(op.column.type, columnTypes);
      const canonDefault = validateDefault(op.column.default);
      const nullable = op.column.isPrimaryKey ? false : op.column.nullable;
      return {
        kind: 'addColumn',
        column: {
          ...op.column,
          type,
          nullable,
          ...(canonDefault !== null ? { default: canonDefault } : { default: undefined }),
        },
      };
    }
    case 'dropColumn': {
      if (!colNames.has(op.column)) {
        throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
      }
      const col = columns.find((column) => column.name === op.column)!;
      if (col.isPrimaryKey) {
        throw new UnprocessableEntityException(`Cannot drop primary key column "${op.column}"`);
      }
      return op;
    }
    case 'setNotNull':
      if (!colNames.has(op.column)) {
        throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
      }
      return op;
    case 'setDefault': {
      if (!colNames.has(op.column)) {
        throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
      }
      let canonDefault: string | null = null;
      if (op.default !== null) {
        canonDefault = validateDefault(op.default);
        if (canonDefault === null) {
          throw new UnprocessableEntityException('Default value cannot be empty; pass null to drop the default');
        }
      }
      return { ...op, default: canonDefault };
    }
    case 'changeType':
      if (!colNames.has(op.column)) {
        throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
      }
      return { ...op, type: validateType(op.type, columnTypes) };
    case 'addForeignKey':
    case 'dropForeignKey':
      throw new UnprocessableEntityException('SQLite does not support adding or dropping foreign key constraints');
    default:
      throw new UnprocessableEntityException('Unknown operation kind');
  }
}

export function sqliteNormalizeCreateIndex(
  req: CreateIndexRequest,
): { request: CreateIndexRequest; name: string; method: string } {
  const method = (req.method ?? 'btree').toLowerCase();
  if (method !== 'btree') {
    throw new UnprocessableEntityException(`Unsupported index method "${req.method}". Allowed: btree`);
  }

  let name = req.name;
  if (!name) {
    const raw = `${req.table}_${req.columns.join('_')}_idx`;
    name = raw.length > 63 ? raw.slice(0, 59) + '_idx' : raw;
  }

  return { request: req, name, method };
}

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
           ti.dflt_value AS default_value,
           CASE WHEN ti.pk = 1 AND UPPER(ti.type) = 'INTEGER'
             AND (SELECT COUNT(*) FROM pragma_table_info(m.name) WHERE pk > 0) = 1
             THEN 1 ELSE 0 END AS is_auto_increment,
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
           dflt_value AS default_value,
           CASE WHEN pk = 1 AND UPPER(type) = 'INTEGER'
             AND (SELECT COUNT(*) FROM pragma_table_info(?) WHERE pk > 0) = 1
             THEN 1 ELSE 0 END AS is_auto_increment,
           CASE WHEN pk > 0 THEN 1 ELSE 0 END AS is_primary_key
         FROM pragma_table_info(?)
         ORDER BY cid`,
    params: [ref.name, ref.name],
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

/**
 * `columns`/`referenced_columns` come back as JSON-encoded arrays (SQLite has no array type).
 * SQLite FKs are unnamed, so `constraint_name` is synthesized as `fk_<table>_<id>`. `referenced_schema`
 * is always null (single database). A FK declared without an explicit referenced column
 * (`REFERENCES parent`) has a NULL `to` in the pragma — it targets the parent's primary key, so we
 * resolve it to the parent PK column at the matching position (`ti.pk = fk.seq + 1`).
 */
export function sqliteBuildListForeignKeys(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT 'fk_' || ? || '_' || fk.id AS constraint_name,
           json_group_array(fk."from") AS columns,
           NULL AS referenced_schema,
           fk."table" AS referenced_table,
           json_group_array(COALESCE(fk."to",
             (SELECT ti.name FROM pragma_table_info(fk."table") ti WHERE ti.pk = fk.seq + 1)
           )) AS referenced_columns,
           fk.on_delete AS on_delete,
           fk.on_update AS on_update
         FROM pragma_foreign_key_list(?) fk
         GROUP BY fk.id, fk."table", fk.on_delete, fk.on_update
         ORDER BY fk.id`,
    params: [ref.name, ref.name],
  };
}

/**
 * Inverse of `sqliteBuildListForeignKeys`: scans every table's `pragma_foreign_key_list` for FKs
 * that reference `ref`. `table_schema` is always null (single database).
 */
export function sqliteBuildListReferencingForeignKeys(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT 'fk_' || m.name || '_' || fk.id AS constraint_name,
           NULL AS table_schema,
           m.name AS table_name,
           json_group_array(fk."from") AS columns,
           NULL AS referenced_schema,
           fk."table" AS referenced_table,
           json_group_array(COALESCE(fk."to",
             (SELECT ti.name FROM pragma_table_info(fk."table") ti WHERE ti.pk = fk.seq + 1)
           )) AS referenced_columns,
           fk.on_delete AS on_delete,
           fk.on_update AS on_update
         FROM sqlite_master m
         JOIN pragma_foreign_key_list(m.name) fk
         WHERE m.type = 'table' AND fk."table" = ?
         GROUP BY m.name, fk.id, fk."table", fk.on_delete, fk.on_update
         ORDER BY m.name, fk.id`,
    params: [ref.name],
  };
}

/** SQLite exposes views and triggers via `sqlite_master`; no sequences/routines/enums/matviews. */
export function sqliteBuildListAllSchemaObjects(): SqlFragment {
  return {
    sql: `SELECT type AS kind, 'main' AS schema, name AS name, NULL AS comment
          FROM sqlite_master
          WHERE type IN ('view', 'trigger') AND name NOT LIKE 'sqlite_%'
          ORDER BY type, name`,
    params: [],
  };
}

export function sqliteBuildObjectDefinition(kind: SchemaObjectKind, ref: TableRef): SqlFragment {
  if (kind !== 'view' && kind !== 'trigger') {
    throw new Error(`SQLite does not support schema object kind "${kind}"`);
  }
  // `kind` is one of the literal `sqlite_master.type` values ('view'/'trigger') — bind it directly.
  return {
    sql: `SELECT sql AS definition, NULL AS extra FROM sqlite_master WHERE type = ? AND name = ?`,
    params: [kind, ref.name],
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

/**
 * SQLite has no cheap row estimate or on-disk size, so those come back `NULL` (rendered "—").
 * Column/index counts use the correlated pragma table-valued functions, same idiom as
 * `sqliteBuildListAllColumns`. `namespace` is irrelevant (single database) and ignored.
 */
export function sqliteBuildSchemaTableStats(_namespace: string): SqlFragment {
  return {
    sql: `SELECT m.name AS table_name,
           NULL AS row_estimate,
           NULL AS size_bytes,
           (SELECT COUNT(*) FROM pragma_table_info(m.name)) AS column_count,
           (SELECT COUNT(*) FROM pragma_index_list(m.name)) AS index_count,
           NULL AS engine,
           NULL AS collation,
           NULL AS comment
         FROM sqlite_master m
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
         ORDER BY m.name`,
    params: [],
  };
}

export function sqliteBuildDropTable(ref: TableRef): SqlFragment {
  return { sql: `DROP TABLE ${qualify(ref)}`, params: [] };
}

/** SQLite has no TRUNCATE; `DELETE FROM` (no WHERE) is the equivalent "empty the table". */
export function sqliteBuildTruncateTable(ref: TableRef): SqlFragment {
  return { sql: `DELETE FROM ${qualify(ref)}`, params: [] };
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

export function sqliteBuildUpdateRowGuarded(
  ref: TableRef,
  edits: [string, unknown][],
  pkColumns: string[],
  pkValues: unknown[],
  guard: RowUpdateGuard,
): SqlFragment {
  // SQLite has no row-version token; it only ever uses the column pre-image basis.
  if (guard.kind === 'version') {
    throw new Error('SQLite does not support version-token concurrency');
  }
  const setClause = edits.map(([c]) => `${sqliteQuoteIdent(c)} = ?`).join(', ');
  // `IS` (not `=`) so a NULL pre-image matches a NULL current value.
  const where = [
    ...pkColumns.map((c) => `${sqliteQuoteIdent(c)} = ?`),
    ...guard.columns.map((c) => `${sqliteQuoteIdent(c)} IS ?`),
  ].join(' AND ');
  return {
    sql: `UPDATE ${qualify(ref)} SET ${setClause} WHERE ${where} RETURNING *`,
    params: [...edits.map(([, v]) => v), ...pkValues, ...guard.values],
  };
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
    case 'addForeignKey':
    case 'dropForeignKey':
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

export { qualify as sqliteQualify };
