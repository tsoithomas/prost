import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ColumnMetadata,
  ColumnTopValues,
  ForeignKeyMetadata,
  IndexMetadata,
  ReferencingKeyMetadata,
  SchemaForeignKey,
  SchemaMetadata,
  TableProfile,
  SchemaObjectDetail,
  SchemaObjectKind,
  SchemaObjectSummary,
  SchemaOverview,
  TableMetadata,
  TableOverview,
  TableStructure,
} from '@prost/shared-types';
import type { DbDriver } from '../database/db-driver.interface';
import {
  profileAlias,
  PROFILE_MAX_COLUMNS,
  PROFILE_TOP_VALUES_LIMIT,
} from '../database/drivers/profile-sql';
import type { ProfileColumnSpec } from '../database/types';
import { PoolManager } from '../database/pool-manager.service';
import { typeFamily } from '../grid/filter';

/**
 * Whether the engine can compare values of this type at all. `other` (json/xml/array/binary) has no
 * engine-wide equality or ordering, so `COUNT(DISTINCT)`, `MIN`/`MAX` and `GROUP BY` are all unsafe.
 */
function isComparable(dataType: string): boolean {
  return typeFamily(dataType) !== 'other';
}

/** A number the source may leave null; coerce to a non-negative integer, preserving null. */
function toCountOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Comments come back as `''` when unset on MySQL and as NULL elsewhere — normalize to null. */
function emptyToNull(value: unknown): string | null {
  const text = toStringOrNull(value);
  return text === null || text === '' ? null : text;
}

/** Index `columns` arrive as a real array (PG) or a JSON-encoded array string (SQLite). */
function toColumnArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * An object-definition `extra` arrives as a real object (PG `json`) or a JSON-encoded string
 * (MySQL/SQLite `JSON_OBJECT`). Normalize to a flat `Record<string,string>`, dropping null values.
 */
function normalizeExtra(value: Record<string, unknown> | string): Record<string, string> {
  let obj: unknown = value;
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (obj === null || typeof obj !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== null && v !== undefined) out[k] = String(v);
  }
  return out;
}

interface TableRow {
  table_schema: string;
  table_name: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  is_primary_key: boolean;
  default_value: string | null;
  is_auto_increment: boolean | number;
  /** Native column comment; absent on engines without comment support (SQLite). */
  comment?: string | null;
  /** MySQL only — the catalog's own column definition, needed to restate a column (Phase 38). */
  column_definition?: string | null;
  /** MySQL only — non-empty for generated columns, which can't be restated. */
  generation_expression?: string | null;
}

interface AllColumnsRow extends ColumnRow {
  table_schema: string;
  table_name: string;
}

interface IndexRow {
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  method: string;
  definition: string;
  columns: string[];
}

interface ForeignKeyRow {
  constraint_name: string;
  columns: string[] | string;
  referenced_schema: string | null;
  referenced_table: string;
  referenced_columns: string[] | string;
  on_delete: string | null;
  on_update: string | null;
}

interface ReferencingKeyRow extends ForeignKeyRow {
  table_schema: string | null;
  table_name: string;
}

interface SchemaObjectRow {
  kind: SchemaObjectKind;
  schema: string | null;
  name: string;
  comment: string | null;
}

interface ObjectDefinitionRow {
  definition: string | null;
  /** JSON object (real object on PG `json`, JSON string on MySQL/SQLite), or null. */
  extra: Record<string, unknown> | string | null;
}

interface TopValueRow {
  value: unknown;
  occurrences: number | string | null;
  scanned_rows: number | string | null;
}

interface TableStatsRow {
  table_name: string;
  row_estimate: number | string | null;
  size_bytes: number | string | null;
  column_count: number | string | null;
  index_count: number | string | null;
  engine: string | null;
  collation: string | null;
  comment: string | null;
}

@Injectable()
export class MetadataService {
  constructor(private readonly pool: PoolManager) {}

  async getSchemas(connectionId: string): Promise<SchemaMetadata[]> {
    const driver = await this.pool.driverFor(connectionId);
    const [{ rows: tableRows }, { rows: colRows }, { rows: objectRows }] = await Promise.all([
      this.pool.run(connectionId, driver.buildListTables()) as unknown as Promise<{ rows: TableRow[] }>,
      this.pool.run(connectionId, driver.buildListAllColumns()) as unknown as Promise<{ rows: AllColumnsRow[] }>,
      this.pool.run(connectionId, driver.buildListAllSchemaObjects()) as unknown as Promise<{ rows: SchemaObjectRow[] }>,
    ]);

    const colMap = new Map<string, ColumnMetadata[]>();
    for (const col of colRows) {
      const key = `${col.table_schema}.${col.table_name}`;
      const list = colMap.get(key) ?? [];
      list.push({
        name: col.column_name,
        dataType: col.data_type,
        nullable: col.is_nullable === 'YES',
        isPrimaryKey: Boolean(col.is_primary_key),
        autoIncrement: Boolean(col.is_auto_increment),
        defaultValue: col.default_value == null ? null : String(col.default_value),
      });
      colMap.set(key, list);
    }

    const tableMap = new Map<string, TableMetadata[]>();
    for (const row of tableRows) {
      const tables = tableMap.get(row.table_schema) ?? [];
      tables.push({ schema: row.table_schema, name: row.table_name, columns: colMap.get(`${row.table_schema}.${row.table_name}`) ?? [] });
      tableMap.set(row.table_schema, tables);
    }

    const objectMap = new Map<string, SchemaObjectSummary[]>();
    for (const row of objectRows) {
      const key = row.schema ?? '';
      const list = objectMap.get(key) ?? [];
      list.push({
        kind: row.kind,
        schema: row.schema,
        name: row.name,
        ...(row.comment == null ? {} : { comment: String(row.comment) }),
      });
      objectMap.set(key, list);
    }

    // Seed schema names from both tables and objects, so a schema holding only views still appears.
    const names = new Set<string>([...tableMap.keys(), ...objectMap.keys()]);
    return Array.from(names)
      .sort()
      .map((name) => ({ name, tables: tableMap.get(name) ?? [], objects: objectMap.get(name) ?? [] }));
  }

  async getObjectDefinition(
    connectionId: string,
    schema: string,
    kind: SchemaObjectKind,
    name: string,
  ): Promise<SchemaObjectDetail> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(
      connectionId,
      driver.buildObjectDefinition(kind, { namespace: schema, name }),
    )) as unknown as { rows: ObjectDefinitionRow[] };

    const row = rows[0];
    return {
      kind,
      schema,
      name,
      ...(row?.definition == null ? {} : { definition: String(row.definition) }),
      ...(row?.extra == null ? {} : { extra: normalizeExtra(row.extra) }),
    };
  }

  async getTableColumns(connectionId: string, schema: string, table: string): Promise<ColumnMetadata[]> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(connectionId, driver.buildListColumns({ namespace: schema, name: table }))) as unknown as {
      rows: ColumnRow[];
    };

    return rows.map((row) => ({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      isPrimaryKey: Boolean(row.is_primary_key),
      autoIncrement: Boolean(row.is_auto_increment),
      defaultValue: row.default_value == null ? null : String(row.default_value),
      comment: emptyToNull(row.comment),
      // Only carried where the engine needs it to restate a column; a generated column reports its
      // expression instead, and the driver refuses to rewrite those.
      ...(row.column_definition && !row.generation_expression
        ? { nativeDefinition: String(row.column_definition) }
        : {}),
    }));
  }

  async getTableIndexes(connectionId: string, schema: string, table: string): Promise<IndexMetadata[]> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(connectionId, driver.buildListIndexes({ namespace: schema, name: table }))) as unknown as {
      rows: IndexRow[];
    };

    return rows.map((row) => ({
      name: row.name,
      columns: toColumnArray(row.columns),
      isUnique: Boolean(row.is_unique),
      isPrimary: Boolean(row.is_primary),
      method: row.method,
      definition: row.definition,
    }));
  }

  async getTableForeignKeys(connectionId: string, schema: string, table: string): Promise<ForeignKeyMetadata[]> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(
      connectionId,
      driver.buildListForeignKeys({ namespace: schema, name: table }),
    )) as unknown as { rows: ForeignKeyRow[] };

    return rows.map((row) => ({
      constraintName: row.constraint_name,
      columns: toColumnArray(row.columns),
      referencedSchema: row.referenced_schema == null ? null : String(row.referenced_schema),
      referencedTable: row.referenced_table,
      referencedColumns: toColumnArray(row.referenced_columns),
      onDelete: row.on_delete == null ? undefined : String(row.on_delete),
      onUpdate: row.on_update == null ? undefined : String(row.on_update),
    }));
  }

  async getReferencingForeignKeys(connectionId: string, schema: string, table: string): Promise<ReferencingKeyMetadata[]> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(
      connectionId,
      driver.buildListReferencingForeignKeys({ namespace: schema, name: table }),
    )) as unknown as { rows: ReferencingKeyRow[] };

    return rows.map((row) => ({
      constraintName: row.constraint_name,
      table: row.table_name,
      schema: row.table_schema == null ? null : String(row.table_schema),
      columns: toColumnArray(row.columns),
      referencedSchema: row.referenced_schema == null ? null : String(row.referenced_schema),
      referencedTable: row.referenced_table,
      referencedColumns: toColumnArray(row.referenced_columns),
      onDelete: row.on_delete == null ? undefined : String(row.on_delete),
      onUpdate: row.on_update == null ? undefined : String(row.on_update),
    }));
  }

  /**
   * Every FK owned by a table in `schema`, in one read — the edges of the ER diagram (Phase 36).
   * Same normalization as the per-table reads; the driver decides the SQL, the service never does.
   */
  async getSchemaForeignKeys(connectionId: string, schema: string): Promise<SchemaForeignKey[]> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(
      connectionId,
      driver.buildListSchemaForeignKeys(schema),
    )) as unknown as { rows: ReferencingKeyRow[] };

    return rows.map((row) => ({
      constraintName: row.constraint_name,
      table: row.table_name,
      schema: row.table_schema == null ? null : String(row.table_schema),
      columns: toColumnArray(row.columns),
      referencedSchema: row.referenced_schema == null ? null : String(row.referenced_schema),
      referencedTable: row.referenced_table,
      referencedColumns: toColumnArray(row.referenced_columns),
      onDelete: row.on_delete == null ? undefined : String(row.on_delete),
      onUpdate: row.on_update == null ? undefined : String(row.on_update),
    }));
  }

  /** The table's own native comment; `null` where unset or unsupported (SQLite). */
  async getTableComment(connectionId: string, schema: string, table: string): Promise<string | null> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = await this.pool.run(connectionId, driver.buildTableComment({ namespace: schema, name: table }));
    return emptyToNull((rows[0] as { comment?: unknown } | undefined)?.comment);
  }

  async getTableStructure(connectionId: string, schema: string, table: string): Promise<TableStructure> {
    const [columns, indexes, foreignKeys, comment] = await Promise.all([
      this.getTableColumns(connectionId, schema, table),
      this.getTableIndexes(connectionId, schema, table),
      this.getTableForeignKeys(connectionId, schema, table),
      this.getTableComment(connectionId, schema, table),
    ]);
    return { columns, indexes, foreignKeys, comment };
  }

  /**
   * On-demand data profile of a table (Phase 37): one bounded pass computing null/distinct/min/max
   * per column. The driver decides how the scan is bounded (`planProfileSample`); the service just
   * reports which plan was used, so the UI can label sampled numbers honestly.
   */
  async getTableProfile(connectionId: string, schema: string, table: string, exact: boolean): Promise<TableProfile> {
    const driver = await this.pool.driverFor(connectionId);
    const ref = { namespace: schema, name: table };
    const allColumns = await this.getTableColumns(connectionId, schema, table);
    const columns = allColumns.slice(0, PROFILE_MAX_COLUMNS);
    const specs: ProfileColumnSpec[] = columns.map((column) => ({
      name: column.name,
      orderable: isComparable(column.dataType),
    }));

    const totalRows = await this.countRows(connectionId, driver, ref, exact);
    const plan = driver.planProfileSample(totalRows ?? 0, exact);
    const { rows } = await this.pool.run(connectionId, driver.buildColumnProfile(ref, specs, plan));
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    const scannedRows = toCountOrNull(row.scanned_rows) ?? 0;

    return {
      schema,
      table,
      scannedRows,
      totalRows,
      sample: plan.kind,
      exact,
      columnsOmitted: allColumns.length - columns.length,
      columns: columns.map((column, i) => {
        const nullCount = toCountOrNull(row[profileAlias(i, 'nulls')]) ?? 0;
        return {
          column: column.name,
          dataType: column.dataType,
          nullCount,
          nullFraction: scannedRows > 0 ? nullCount / scannedRows : 0,
          distinctCount: toCountOrNull(row[profileAlias(i, 'distinct')]),
          min: toStringOrNull(row[profileAlias(i, 'min')]),
          max: toStringOrNull(row[profileAlias(i, 'max')]),
          comparable: specs[i]!.orderable,
        };
      }),
    };
  }

  /** The most common values of one column, fetched lazily when its profile row is expanded. */
  async getColumnTopValues(
    connectionId: string,
    schema: string,
    table: string,
    column: string,
    exact: boolean,
  ): Promise<ColumnTopValues> {
    const columns = await this.getTableColumns(connectionId, schema, table);
    const target = columns.find((candidate) => candidate.name === column);
    if (!target) {
      throw new BadRequestException(`Unknown column "${column}"`);
    }
    if (!isComparable(target.dataType)) {
      throw new BadRequestException(
        `Column "${column}" has type "${target.dataType}", which the engine cannot group or compare`,
      );
    }

    const driver = await this.pool.driverFor(connectionId);
    const ref = { namespace: schema, name: table };
    // Planning always uses the cheap estimate; `exact` only means "don't sample".
    const plan = driver.planProfileSample(await this.estimateRows(connectionId, driver, ref), exact);
    const { rows } = (await this.pool.run(
      connectionId,
      driver.buildColumnTopValues(ref, column, plan, PROFILE_TOP_VALUES_LIMIT),
    )) as unknown as { rows: TopValueRow[] };

    const scannedRows = toCountOrNull(rows[0]?.scanned_rows) ?? 0;
    return {
      column,
      scannedRows,
      values: rows.map((row) => {
        const count = toCountOrNull(row.occurrences) ?? 0;
        return {
          value: toStringOrNull(row.value),
          count,
          fraction: scannedRows > 0 ? count / scannedRows : 0,
        };
      }),
    };
  }

  /** Whole-table size: an exact `COUNT(*)` on request, else the engine's cheap catalog estimate. */
  private async countRows(
    connectionId: string,
    driver: DbDriver,
    ref: { namespace: string; name: string },
    exact: boolean,
  ): Promise<number | null> {
    if (!exact) return this.estimateRows(connectionId, driver, ref);
    const { rows } = await this.pool.run(connectionId, driver.buildFilteredRowCount(ref, '', []));
    return toCountOrNull((rows[0] as { count?: unknown } | undefined)?.count);
  }

  private async estimateRows(
    connectionId: string,
    driver: DbDriver,
    ref: { namespace: string; name: string },
  ): Promise<number> {
    const { rows } = await this.pool.run(connectionId, driver.buildRowCountEstimate(ref));
    // PG reports -1 for a never-analyzed relation (and a view has no real count); `toCountOrNull`
    // clamps that to 0, which keeps those off the sampling path.
    return toCountOrNull((rows[0] as { reltuples?: unknown } | undefined)?.reltuples) ?? 0;
  }

  async getSchemaOverview(connectionId: string, schema: string): Promise<SchemaOverview> {
    const driver = await this.pool.driverFor(connectionId);
    const { rows } = (await this.pool.run(connectionId, driver.buildSchemaTableStats(schema))) as unknown as {
      rows: TableStatsRow[];
    };

    const tables: TableOverview[] = rows.map((row) => ({
      schema,
      name: row.table_name,
      rowEstimate: toCountOrNull(row.row_estimate),
      sizeBytes: toCountOrNull(row.size_bytes),
      columnCount: toCountOrNull(row.column_count) ?? 0,
      indexCount: toCountOrNull(row.index_count) ?? 0,
      engine: toStringOrNull(row.engine),
      collation: toStringOrNull(row.collation),
      comment: toStringOrNull(row.comment),
    }));

    const sumOrNull = (pick: (t: TableOverview) => number | null): number | null => {
      const present = tables.map(pick).filter((v): v is number => v !== null);
      return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
    };

    return {
      schema,
      tables,
      totalRowEstimate: sumOrNull((t) => t.rowEstimate),
      totalSizeBytes: sumOrNull((t) => t.sizeBytes),
    };
  }
}
