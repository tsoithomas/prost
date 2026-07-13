import { Injectable } from '@nestjs/common';
import type {
  ColumnMetadata,
  ForeignKeyMetadata,
  IndexMetadata,
  ReferencingKeyMetadata,
  SchemaMetadata,
  SchemaObjectDetail,
  SchemaObjectKind,
  SchemaObjectSummary,
  SchemaOverview,
  TableMetadata,
  TableOverview,
  TableStructure,
} from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';

/** A number the source may leave null; coerce to a non-negative integer, preserving null. */
function toCountOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
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

  async getTableStructure(connectionId: string, schema: string, table: string): Promise<TableStructure> {
    const [columns, indexes, foreignKeys] = await Promise.all([
      this.getTableColumns(connectionId, schema, table),
      this.getTableIndexes(connectionId, schema, table),
      this.getTableForeignKeys(connectionId, schema, table),
    ]);
    return { columns, indexes, foreignKeys };
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
