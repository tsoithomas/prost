import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import { ROW_VERSION_KEY } from '@prost/shared-types';
import type {
  AlterTableOperation,
  ColumnMetadata,
  CreateIndexRequest,
  CreateTableRequest,
  NewColumn,
  SchemaObjectKind,
} from '@prost/shared-types';
import type { RowUpdateGuard, SelectRowsOptions, SqlFragment, TableRef } from '../../types';

const ALLOWED_TYPES = new Set([
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'boolean', 'text', 'varchar', 'char',
  'real', 'double precision', 'numeric',
  'date', 'time', 'timestamp', 'timestamptz',
  'uuid', 'json', 'jsonb', 'bytea',
]);

const PARAMETERIZED_TYPES = new Set(['varchar', 'char', 'numeric']);

const TYPE_PATTERN = /^([a-z]+(?: [a-z]+)*)(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/;

const SAFE_DEFAULT_PATTERN = /^(\d+|true|false|null|now\(\)|current_timestamp|gen_random_uuid\(\))$/i;

const ALLOWED_INDEX_METHODS = new Set(['btree', 'hash', 'gin', 'gist', 'brin']);

const USING_PATTERN = /^[a-z_][a-z0-9_]*(::([a-z][a-z0-9 ]*)(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)?$/i;

function validateType(type: string): string {
  const normalized = type.trim().toLowerCase().replace(/\s+/g, ' ');
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
      `Unsupported default value "${value}". Allowed: now(), current_timestamp, gen_random_uuid(), true, false, null, or a non-negative integer`,
    );
  }
  return trimmed.toLowerCase();
}

function normalizeColumn(col: NewColumn): NewColumn {
  const type = validateType(col.type);
  const canonicalDefault = validateDefault(col.default);
  return {
    name: col.name,
    type,
    nullable: col.nullable,
    isPrimaryKey: col.isPrimaryKey,
    ...(canonicalDefault !== null ? { default: canonicalDefault } : {}),
  };
}

export function pgNormalizeCreateTable(req: CreateTableRequest): CreateTableRequest {
  return {
    schema: req.schema,
    table: req.table,
    columns: req.columns.map(normalizeColumn),
  };
}

export function pgNormalizeAlterTable(
  _ref: TableRef,
  op: AlterTableOperation,
  columns: ColumnMetadata[],
): AlterTableOperation {
  const colNames = new Set(columns.map((column) => column.name));

  switch (op.kind) {
    case 'addColumn': {
      if (colNames.has(op.column.name)) {
        throw new ConflictException(`Column "${op.column.name}" already exists`);
      }
      const type = validateType(op.column.type);
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
    case 'changeType': {
      if (!colNames.has(op.column)) {
        throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
      }
      const type = validateType(op.type);
      let using: string | undefined;
      if (op.using !== undefined) {
        const trimmed = op.using.trim();
        if (!USING_PATTERN.test(trimmed)) {
          throw new UnprocessableEntityException(
            `Unsupported USING expression "${op.using}". Allowed: identifier or identifier::type`,
          );
        }
        using = trimmed.toLowerCase();
      }
      return { kind: 'changeType', column: op.column, type, ...(using !== undefined ? { using } : {}) };
    }
    default:
      throw new UnprocessableEntityException('Unknown operation kind');
  }
}

export function pgNormalizeCreateIndex(
  req: CreateIndexRequest,
): { request: CreateIndexRequest; name: string; method: string } {
  const method = (req.method ?? 'btree').toLowerCase();
  if (!ALLOWED_INDEX_METHODS.has(method)) {
    throw new UnprocessableEntityException(
      `Unsupported index method "${req.method}". Allowed: ${[...ALLOWED_INDEX_METHODS].join(', ')}`,
    );
  }

  let name = req.name;
  if (!name) {
    const raw = `${req.table}_${req.columns.join('_')}_idx`;
    name = raw.length > 63 ? raw.slice(0, 59) + '_idx' : raw;
  }

  return { request: req, name, method };
}

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
           c.column_default AS default_value,
           (c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%') AS is_auto_increment,
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
         c.column_default AS default_value,
         (c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%') AS is_auto_increment,
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

/** Maps `pg_constraint.confdeltype`/`confupdtype` single-char codes to referential-action names. */
const PG_FK_ACTION = `CASE $CODE$
           WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
           WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END`;

export function pgBuildListForeignKeys(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         con.conname AS constraint_name,
         ARRAY(
           SELECT a.attname
           FROM   unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN   pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         )::text[] AS columns,
         rns.nspname AS referenced_schema,
         rcl.relname AS referenced_table,
         ARRAY(
           SELECT a.attname
           FROM   unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN   pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         )::text[] AS referenced_columns,
         ${PG_FK_ACTION.replace('$CODE$', 'con.confdeltype')} AS on_delete,
         ${PG_FK_ACTION.replace('$CODE$', 'con.confupdtype')} AS on_update
       FROM   pg_constraint con
       JOIN   pg_class     cl  ON cl.oid  = con.conrelid
       JOIN   pg_namespace n   ON n.oid   = cl.relnamespace
       JOIN   pg_class     rcl ON rcl.oid = con.confrelid
       JOIN   pg_namespace rns ON rns.oid = rcl.relnamespace
       WHERE  con.contype = 'f'
         AND  n.nspname = $1
         AND  cl.relname = $2
       ORDER BY con.conname`,
    params: [ref.namespace, ref.name],
  };
}

export function pgBuildListReferencingForeignKeys(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         con.conname AS constraint_name,
         n.nspname AS table_schema,
         cl.relname AS table_name,
         ARRAY(
           SELECT a.attname
           FROM   unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN   pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         )::text[] AS columns,
         rns.nspname AS referenced_schema,
         rcl.relname AS referenced_table,
         ARRAY(
           SELECT a.attname
           FROM   unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN   pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         )::text[] AS referenced_columns,
         ${PG_FK_ACTION.replace('$CODE$', 'con.confdeltype')} AS on_delete,
         ${PG_FK_ACTION.replace('$CODE$', 'con.confupdtype')} AS on_update
       FROM   pg_constraint con
       JOIN   pg_class     cl  ON cl.oid  = con.conrelid
       JOIN   pg_namespace n   ON n.oid   = cl.relnamespace
       JOIN   pg_class     rcl ON rcl.oid = con.confrelid
       JOIN   pg_namespace rns ON rns.oid = rcl.relnamespace
       WHERE  con.contype = 'f'
         AND  rns.nspname = $1
         AND  rcl.relname = $2
       ORDER BY n.nspname, cl.relname, con.conname`,
    params: [ref.namespace, ref.name],
  };
}

const PG_SYS_SCHEMAS = `NOT IN ('pg_catalog', 'information_schema') AND %C% NOT LIKE 'pg_toast%' AND %C% NOT LIKE 'pg_temp%'`;

/** All non-table schema objects across user schemas, one aliased row each: `kind, schema, name, comment`. */
export function pgBuildListAllSchemaObjects(): SqlFragment {
  const sys = (col: string) => `${col} ${PG_SYS_SCHEMAS.replace(/%C%/g, col)}`;
  return {
    sql: `SELECT CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView' WHEN 'S' THEN 'sequence' END AS kind,
             n.nspname AS schema, c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('v', 'm', 'S') AND ${sys('n.nspname')}
         UNION ALL
           SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
             n.nspname, p.proname, obj_description(p.oid, 'pg_proc')
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE p.prokind IN ('f', 'p') AND ${sys('n.nspname')}
         UNION ALL
           SELECT 'trigger', n.nspname, t.tgname, obj_description(t.oid, 'pg_trigger')
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE NOT t.tgisinternal AND ${sys('n.nspname')}
         UNION ALL
           SELECT 'enum', n.nspname, t.typname, obj_description(t.oid, 'pg_type')
           FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE t.typtype = 'e' AND ${sys('n.nspname')}
         ORDER BY schema, kind, name`,
    params: [],
  };
}

/** One object's `definition` (+ `extra` JSON) for the definition panel. Read-only catalog lookups. */
export function pgBuildObjectDefinition(kind: SchemaObjectKind, ref: TableRef): SqlFragment {
  const params = [ref.namespace, ref.name];
  switch (kind) {
    case 'view':
    case 'materializedView':
      return {
        sql: `SELECT pg_get_viewdef((quote_ident($1) || '.' || quote_ident($2))::regclass, true) AS definition,
                NULL::json AS extra`,
        params,
      };
    case 'function':
    case 'procedure':
      return {
        sql: `SELECT pg_get_functiondef(p.oid) AS definition,
                json_build_object('language', l.lanname) AS extra
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
              WHERE n.nspname = $1 AND p.proname = $2 ORDER BY p.oid LIMIT 1`,
        params,
      };
    case 'trigger':
      return {
        sql: `SELECT pg_get_triggerdef(t.oid) AS definition, NULL::json AS extra
              FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE NOT t.tgisinternal AND n.nspname = $1 AND t.tgname = $2 ORDER BY t.oid LIMIT 1`,
        params,
      };
    case 'sequence':
      return {
        sql: `SELECT format('CREATE SEQUENCE %I.%I START %s INCREMENT %s MINVALUE %s MAXVALUE %s%s',
                schemaname, sequencename, start_value, increment_by, min_value, max_value,
                CASE WHEN cycle THEN ' CYCLE' ELSE '' END) AS definition,
                json_build_object('lastValue', COALESCE(last_value::text, 'unused')) AS extra
              FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2`,
        params,
      };
    case 'enum':
      return {
        sql: `SELECT format('CREATE TYPE %I.%I AS ENUM (%s)', $1, $2,
                string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)) AS definition,
                json_build_object('labels', string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)) AS extra
              FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = $1 AND t.typname = $2`,
        params,
      };
  }
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

export function pgBuildSchemaTableStats(namespace: string): SqlFragment {
  return {
    sql: `SELECT
         c.relname                                        AS table_name,
         c.reltuples::bigint                              AS row_estimate,
         pg_total_relation_size(c.oid)                    AS size_bytes,
         (SELECT count(*) FROM information_schema.columns col
            WHERE col.table_schema = n.nspname AND col.table_name = c.relname) AS column_count,
         (SELECT count(*) FROM pg_index ix WHERE ix.indrelid = c.oid) AS index_count,
         NULL::text                                       AS engine,
         NULL::text                                       AS collation,
         obj_description(c.oid, 'pg_class')               AS comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'
       ORDER BY c.relname`,
    params: [namespace],
  };
}

export function pgBuildDropTable(ref: TableRef): SqlFragment {
  return { sql: `DROP TABLE ${qualify(ref)}`, params: [] };
}

export function pgBuildTruncateTable(ref: TableRef): SqlFragment {
  return { sql: `TRUNCATE TABLE ${qualify(ref)}`, params: [] };
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
