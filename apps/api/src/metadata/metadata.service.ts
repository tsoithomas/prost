import { Injectable } from '@nestjs/common';
import type {
  ColumnMetadata,
  IndexMetadata,
  SchemaMetadata,
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
    const [{ rows: tableRows }, { rows: colRows }] = await Promise.all([
      this.pool.run(connectionId, driver.buildListTables()) as unknown as Promise<{ rows: TableRow[] }>,
      this.pool.run(connectionId, driver.buildListAllColumns()) as unknown as Promise<{ rows: AllColumnsRow[] }>,
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

    const schemas = new Map<string, TableMetadata[]>();
    for (const row of tableRows) {
      const tables = schemas.get(row.table_schema) ?? [];
      tables.push({ schema: row.table_schema, name: row.table_name, columns: colMap.get(`${row.table_schema}.${row.table_name}`) ?? [] });
      schemas.set(row.table_schema, tables);
    }

    return Array.from(schemas.entries()).map(([name, tables]) => ({ name, tables }));
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

  async getTableStructure(connectionId: string, schema: string, table: string): Promise<TableStructure> {
    const [columns, indexes] = await Promise.all([
      this.getTableColumns(connectionId, schema, table),
      this.getTableIndexes(connectionId, schema, table),
    ]);
    return { columns, indexes };
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
