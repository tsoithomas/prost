import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AlterTableOperation,
  ColumnMetadata,
  CreateIndexRequest,
  CreateTableRequest,
  NewColumn,
} from '@prost/shared-types';
import type { RowUpdateGuard, SelectRowsOptions, SqlFragment, TableRef } from '../../types';

const ALLOWED_TYPES = new Set([
  'BIGINT',
  'BIGINT UNSIGNED',
  'BINARY',
  'BIT',
  'BLOB',
  'BOOL',
  'BOOLEAN',
  'CHAR',
  'DATE',
  'DATETIME',
  'DECIMAL',
  'DOUBLE',
  'DOUBLE PRECISION',
  'FLOAT',
  'INT',
  'INT UNSIGNED',
  'INTEGER',
  'INTEGER UNSIGNED',
  'JSON',
  'LONGBLOB',
  'LONGTEXT',
  'MEDIUMBLOB',
  'MEDIUMINT',
  'MEDIUMINT UNSIGNED',
  'MEDIUMTEXT',
  'NUMERIC',
  'REAL',
  'SMALLINT',
  'SMALLINT UNSIGNED',
  'TEXT',
  'TIME',
  'TIMESTAMP',
  'TINYBLOB',
  'TINYINT',
  'TINYINT UNSIGNED',
  'TINYTEXT',
  'VARBINARY',
  'VARCHAR',
  'YEAR',
]);

const PARAMETERIZED_TYPES = new Set([
  'BINARY',
  'BIT',
  'CHAR',
  'DECIMAL',
  'NUMERIC',
  'TIME',
  'DATETIME',
  'TIMESTAMP',
  'TINYINT',
  'TINYINT UNSIGNED',
  'VARBINARY',
  'VARCHAR',
]);

const TYPE_PATTERN = /^([a-z]+(?: [a-z]+)*)(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/i;
const SAFE_DEFAULT_PATTERN = /^(\d+|true|false|null|now\(\)|current_timestamp(?:\(\))?)$/i;
const MYSQL_COLUMN_DEFINITION = Symbol('mysqlColumnDefinition');

type NormalizedAlterOperation = AlterTableOperation & {
  [MYSQL_COLUMN_DEFINITION]?: NewColumn;
};

function validateType(type: string): string {
  const normalized = type.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = TYPE_PATTERN.exec(normalized);
  const base = match?.[1];
  const params = match?.[2];
  if (!base || !ALLOWED_TYPES.has(base)) {
    throw new UnprocessableEntityException(
      `Unsupported column type "${type}". Allowed types: ${[...ALLOWED_TYPES].join(', ')}`,
    );
  }
  if (params && !PARAMETERIZED_TYPES.has(base)) {
    throw new UnprocessableEntityException(`Type "${base}" does not accept a length/precision parameter`);
  }
  return `${base}${params ? params.replace(/\s+/g, '') : ''}`;
}

function validateDefault(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!SAFE_DEFAULT_PATTERN.test(trimmed)) {
    throw new UnprocessableEntityException(
      `Unsupported default value "${value}". Allowed: now(), current_timestamp, true, false, null, or a non-negative integer`,
    );
  }
  return trimmed.toLowerCase();
}

function normalizeColumn(column: NewColumn): NewColumn {
  const canonicalDefault = validateDefault(column.default);
  return {
    name: column.name,
    type: validateType(column.type),
    nullable: column.isPrimaryKey ? false : column.nullable,
    isPrimaryKey: column.isPrimaryKey,
    ...(column.autoIncrement !== undefined ? { autoIncrement: column.autoIncrement } : {}),
    ...(canonicalDefault !== null ? { default: canonicalDefault } : {}),
  };
}

function attachColumnDefinition(
  operation: AlterTableOperation,
  column: NewColumn,
): AlterTableOperation {
  Object.defineProperty(operation, MYSQL_COLUMN_DEFINITION, {
    configurable: false,
    enumerable: false,
    value: column,
    writable: false,
  });
  return operation;
}

function fromColumnMetadata(column: ColumnMetadata): NewColumn {
  return {
    name: column.name,
    type: validateType(column.dataType),
    nullable: column.nullable,
    isPrimaryKey: column.isPrimaryKey,
    autoIncrement: column.autoIncrement,
    ...(column.defaultValue !== null ? { default: column.defaultValue } : {}),
  };
}

function requireColumn(columns: ColumnMetadata[], name: string): ColumnMetadata {
  const column = columns.find((candidate) => candidate.name === name);
  if (!column) {
    throw new UnprocessableEntityException(`Column "${name}" does not exist`);
  }
  return column;
}

function buildColumnDefinition(column: NewColumn, includeName = true): string {
  let definition = includeName ? `${mysqlQuoteIdent(column.name)} ${column.type}` : column.type;
  definition += column.nullable ? ' NULL' : ' NOT NULL';
  if (column.default !== undefined && column.default !== '') {
    definition += ` DEFAULT ${column.default.trim()}`;
  }
  if (column.autoIncrement) definition += ' AUTO_INCREMENT';
  return definition;
}

export function mysqlNormalizeCreateTable(req: CreateTableRequest): CreateTableRequest {
  return {
    schema: req.schema,
    table: req.table,
    columns: req.columns.map(normalizeColumn),
  };
}

export function mysqlNormalizeAlterTable(
  _ref: TableRef,
  op: AlterTableOperation,
  columns: ColumnMetadata[],
): AlterTableOperation {
  const columnNames = new Set(columns.map((column) => column.name));

  switch (op.kind) {
    case 'addColumn': {
      if (columnNames.has(op.column.name)) {
        throw new ConflictException(`Column "${op.column.name}" already exists`);
      }
      const column = normalizeColumn(op.column);
      return attachColumnDefinition({ kind: 'addColumn', column }, column);
    }
    case 'dropColumn': {
      const column = requireColumn(columns, op.column);
      if (column.isPrimaryKey) {
        throw new UnprocessableEntityException(`Cannot drop primary key column "${op.column}"`);
      }
      return op;
    }
    case 'setNotNull': {
      const current = fromColumnMetadata(requireColumn(columns, op.column));
      const column = { ...current, nullable: !op.notNull };
      return attachColumnDefinition({ ...op }, column);
    }
    case 'setDefault': {
      const current = fromColumnMetadata(requireColumn(columns, op.column));
      let canonicalDefault: string | null = null;
      if (op.default !== null) {
        canonicalDefault = validateDefault(op.default);
        if (canonicalDefault === null) {
          throw new UnprocessableEntityException('Default value cannot be empty; pass null to drop the default');
        }
      }
      const column: NewColumn = { ...current };
      if (canonicalDefault === null) delete column.default;
      else column.default = canonicalDefault;
      return attachColumnDefinition({ ...op, default: canonicalDefault }, column);
    }
    case 'changeType': {
      const current = fromColumnMetadata(requireColumn(columns, op.column));
      const type = validateType(op.type);
      const column = { ...current, type };
      return attachColumnDefinition({ kind: 'changeType', column: op.column, type }, column);
    }
    default:
      throw new UnprocessableEntityException('Unknown operation kind');
  }
}

export function mysqlNormalizeCreateIndex(
  req: CreateIndexRequest,
): { request: CreateIndexRequest; name: string; method: string } {
  const method = (req.method ?? 'btree').toLowerCase();
  if (method !== 'btree') {
    throw new UnprocessableEntityException(`Unsupported index method "${req.method}". Allowed: btree`);
  }

  let name = req.name;
  if (!name) {
    const raw = `${req.table}_${req.columns.join('_')}_idx`;
    name = raw.length > 63 ? `${raw.slice(0, 59)}_idx` : raw;
  }
  return { request: req, name, method };
}

export function mysqlQuoteIdent(identifier: string): string {
  if (identifier.length === 0) {
    throw new Error('Identifier must not be empty');
  }
  if (identifier.includes('\u0000')) {
    throw new Error('Identifier must not contain null bytes');
  }
  return `\`${identifier.replace(/`/g, '``')}\``;
}

export const mysqlPlaceholder = (_index: number): string => '?';

function qualify(ref: TableRef): string {
  const table = mysqlQuoteIdent(ref.name);
  return ref.namespace ? `${mysqlQuoteIdent(ref.namespace)}.${table}` : table;
}

export function mysqlInList(
  column: string,
  values: unknown[],
  negated: boolean,
  _firstIndex: number,
): { fragment: string; params: unknown[] } {
  if (values.length === 0) {
    return { fragment: negated ? '1=1' : '1=0', params: [] };
  }
  const placeholders = values.map(() => '?').join(', ');
  return {
    fragment: `${column} ${negated ? 'NOT IN' : 'IN'} (${placeholders})`,
    params: values,
  };
}

export function mysqlBuildListTables(): SqlFragment {
  return {
    sql: `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name
         FROM information_schema.tables
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
    params: [],
  };
}

export function mysqlBuildListAllColumns(): SqlFragment {
  return {
    sql: `SELECT TABLE_SCHEMA AS table_schema,
           TABLE_NAME AS table_name,
           COLUMN_NAME AS column_name,
           DATA_TYPE AS data_type,
           IS_NULLABLE AS is_nullable,
           CASE WHEN COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS is_primary_key,
           COLUMN_DEFAULT AS default_value,
           CASE WHEN EXTRA LIKE '%auto_increment%' THEN 1 ELSE 0 END AS is_auto_increment
         FROM information_schema.columns
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    params: [],
  };
}

export function mysqlBuildListColumns(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT COLUMN_NAME AS column_name,
           DATA_TYPE AS data_type,
           IS_NULLABLE AS is_nullable,
           CASE WHEN COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS is_primary_key,
           COLUMN_DEFAULT AS default_value,
           CASE WHEN EXTRA LIKE '%auto_increment%' THEN 1 ELSE 0 END AS is_auto_increment
         FROM information_schema.columns
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
    params: [ref.namespace, ref.name],
  };
}

export function mysqlBuildListIndexes(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT ordered.INDEX_NAME AS name,
           CASE WHEN MIN(ordered.NON_UNIQUE) = 0 THEN 1 ELSE 0 END AS is_unique,
           CASE WHEN ordered.INDEX_NAME = 'PRIMARY' THEN 1 ELSE 0 END AS is_primary,
           LOWER(INDEX_TYPE) AS method,
           CONCAT(
             CASE WHEN MIN(ordered.NON_UNIQUE) = 0 THEN 'UNIQUE ' ELSE '' END,
             'INDEX \`', REPLACE(ordered.INDEX_NAME, '\`', '\`\`'), '\` (',
             GROUP_CONCAT(
               CONCAT('\`', REPLACE(ordered.COLUMN_NAME, '\`', '\`\`'), '\`')
               ORDER BY ordered.SEQ_IN_INDEX SEPARATOR ', '
             ),
             ')'
           ) AS definition,
           JSON_ARRAYAGG(ordered.COLUMN_NAME) AS columns
         FROM (
           SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, SEQ_IN_INDEX
           FROM information_schema.statistics
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           ORDER BY SEQ_IN_INDEX, INDEX_NAME
         ) AS ordered
         GROUP BY ordered.INDEX_NAME, ordered.INDEX_TYPE
         ORDER BY is_primary DESC, name`,
    params: [ref.namespace, ref.name],
  };
}

export function mysqlBuildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment {
  let sql = `SELECT * FROM ${qualify(ref)}`;
  if (opts.whereClause) sql += ` ${opts.whereClause}`;
  if (opts.orderColumn) sql += ` ORDER BY ${mysqlQuoteIdent(opts.orderColumn)} ${opts.sortDir}`;
  sql += ' LIMIT ? OFFSET ?';
  return { sql, params: [...opts.whereParams, opts.limit, opts.offset] };
}

export function mysqlBuildFilteredRowCount(
  ref: TableRef,
  whereClause: string,
  whereParams: unknown[],
): SqlFragment {
  return {
    sql: `SELECT COUNT(*) AS count FROM ${qualify(ref)} ${whereClause}`,
    params: whereParams,
  };
}

export function mysqlBuildRowCountEstimate(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT TABLE_ROWS AS reltuples
         FROM information_schema.tables
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    params: [ref.namespace, ref.name],
  };
}

export function mysqlBuildSchemaTableStats(namespace: string): SqlFragment {
  return {
    sql: `SELECT t.TABLE_NAME                        AS table_name,
           t.TABLE_ROWS                              AS row_estimate,
           (t.DATA_LENGTH + t.INDEX_LENGTH)          AS size_bytes,
           (SELECT COUNT(*) FROM information_schema.columns col
              WHERE col.TABLE_SCHEMA = t.TABLE_SCHEMA AND col.TABLE_NAME = t.TABLE_NAME) AS column_count,
           (SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.statistics s
              WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME) AS index_count,
           t.ENGINE                                  AS engine,
           t.TABLE_COLLATION                         AS collation,
           NULLIF(t.TABLE_COMMENT, '')               AS comment
         FROM information_schema.tables t
         WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
         ORDER BY t.TABLE_NAME`,
    params: [namespace],
  };
}

export function mysqlBuildDropTable(ref: TableRef): SqlFragment {
  return { sql: `DROP TABLE ${qualify(ref)}`, params: [] };
}

export function mysqlBuildTruncateTable(ref: TableRef): SqlFragment {
  return { sql: `TRUNCATE TABLE ${qualify(ref)}`, params: [] };
}

export function mysqlBuildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment {
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${qualify(ref)} () VALUES ()`, params: [] };
  }
  const columns = entries.map(([column]) => mysqlQuoteIdent(column)).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO ${qualify(ref)} (${columns}) VALUES (${placeholders})`,
    params: entries.map(([, value]) => value),
  };
}

export function mysqlBuildUpdateRow(
  ref: TableRef,
  column: string,
  value: unknown,
  pkColumns: string[],
  pkValues: unknown[],
): SqlFragment {
  const whereClause = pkColumns.map((pkColumn) => `${mysqlQuoteIdent(pkColumn)} = ?`).join(' AND ');
  return {
    sql: `UPDATE ${qualify(ref)} SET ${mysqlQuoteIdent(column)} = ? WHERE ${whereClause}`,
    params: [value, ...pkValues],
  };
}

export function mysqlBuildUpdateRowGuarded(
  ref: TableRef,
  edits: [string, unknown][],
  pkColumns: string[],
  pkValues: unknown[],
  guard: RowUpdateGuard,
): SqlFragment {
  // MySQL has no row-version token; it only ever uses the column pre-image basis.
  if (guard.kind === 'version') {
    throw new Error('MySQL does not support version-token concurrency');
  }
  const setClause = edits.map(([column]) => `${mysqlQuoteIdent(column)} = ?`).join(', ');
  // `<=>` is MySQL's NULL-safe equality so a NULL pre-image matches a NULL current value.
  const where = [
    ...pkColumns.map((column) => `${mysqlQuoteIdent(column)} = ?`),
    ...guard.columns.map((column) => `${mysqlQuoteIdent(column)} <=> ?`),
  ].join(' AND ');
  // No RETURNING in MySQL — the caller re-selects the refreshed row (see GridService.bulkUpdate).
  return {
    sql: `UPDATE ${qualify(ref)} SET ${setClause} WHERE ${where}`,
    params: [...edits.map(([, value]) => value), ...pkValues, ...guard.values],
  };
}

export function mysqlBuildDeleteRow(
  ref: TableRef,
  pkColumns: string[],
  pkValues: unknown[],
): SqlFragment {
  const whereClause = pkColumns.map((column) => `${mysqlQuoteIdent(column)} = ?`).join(' AND ');
  return {
    sql: `DELETE FROM ${qualify(ref)} WHERE ${whereClause}`,
    params: pkValues,
  };
}

export function mysqlBuildSelectByPk(
  ref: TableRef,
  pkColumns: string[],
  pkValues: unknown[],
): SqlFragment {
  const whereClause = pkColumns.map((column) => `${mysqlQuoteIdent(column)} = ?`).join(' AND ');
  return {
    sql: `SELECT * FROM ${qualify(ref)} WHERE ${whereClause}`,
    params: pkValues,
  };
}

export function mysqlBuildCreateTable(req: CreateTableRequest): SqlFragment {
  const primaryKey = req.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
  const definitions = req.columns.map((column) => `  ${buildColumnDefinition(column)}`);
  if (primaryKey.length > 0) {
    definitions.push(`  PRIMARY KEY (${primaryKey.map(mysqlQuoteIdent).join(', ')})`);
  }
  return {
    sql: `CREATE TABLE ${mysqlQuoteIdent(req.schema)}.${mysqlQuoteIdent(req.table)} (\n${definitions.join(',\n')}\n)`,
    params: [],
  };
}

export function mysqlBuildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment {
  const prefix = `ALTER TABLE ${qualify(ref)}`;
  const normalized = op as NormalizedAlterOperation;
  switch (op.kind) {
    case 'addColumn':
      return {
        sql: `${prefix} ADD COLUMN ${buildColumnDefinition(op.column)}`,
        params: [],
      };
    case 'dropColumn':
      return {
        sql: `${prefix} DROP COLUMN ${mysqlQuoteIdent(op.column)}`,
        params: [],
      };
    case 'changeType': {
      const definition = normalized[MYSQL_COLUMN_DEFINITION];
      return {
        sql: definition
          ? `${prefix} MODIFY COLUMN ${buildColumnDefinition(definition)}`
          : `${prefix} MODIFY COLUMN ${mysqlQuoteIdent(op.column)} ${op.type}`,
        params: [],
      };
    }
    case 'setNotNull':
    case 'setDefault': {
      const definition = normalized[MYSQL_COLUMN_DEFINITION];
      if (!definition) {
        throw new UnprocessableEntityException(
          `MySQL ${op.kind} must be normalized with the current column metadata before building SQL`,
        );
      }
      return {
        sql: `${prefix} MODIFY COLUMN ${buildColumnDefinition(definition)}`,
        params: [],
      };
    }
  }
}

export function mysqlBuildCreateIndex(
  req: CreateIndexRequest,
  name: string,
  method: string,
): SqlFragment {
  const columns = req.columns.map(mysqlQuoteIdent).join(', ');
  return {
    sql: `CREATE ${req.unique ? 'UNIQUE ' : ''}INDEX ${mysqlQuoteIdent(name)} USING ${method.toUpperCase()} ON ${mysqlQuoteIdent(req.schema)}.${mysqlQuoteIdent(req.table)} (${columns})`,
    params: [],
  };
}

export function mysqlBuildDropIndex(ref: TableRef, indexName: string): SqlFragment {
  return {
    sql: `DROP INDEX ${mysqlQuoteIdent(indexName)} ON ${qualify(ref)}`,
    params: [],
  };
}

const MYSQL_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'decimal',
  1: 'tinyint',
  2: 'smallint',
  3: 'int',
  4: 'float',
  5: 'double',
  6: 'null',
  7: 'timestamp',
  8: 'bigint',
  9: 'mediumint',
  10: 'date',
  11: 'time',
  12: 'datetime',
  13: 'year',
  14: 'date',
  15: 'varchar',
  16: 'bit',
  245: 'json',
  246: 'decimal',
  247: 'enum',
  248: 'set',
  249: 'tinyblob',
  250: 'mediumblob',
  251: 'longblob',
  252: 'text/blob',
  253: 'varchar',
  254: 'string',
  255: 'geometry',
};

export function mysqlTypeName(code: number): string {
  return MYSQL_TYPE_NAMES[code] ?? 'unknown';
}

function formatExplainValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function mysqlFormatExplain(rows: Record<string, unknown>[]): string {
  return rows
    .map((row) => Object.entries(row)
      .map(([key, value]) => `${key}=${formatExplainValue(value)}`)
      .join(' | '))
    .join('\n');
}

export { qualify as mysqlQualify };
