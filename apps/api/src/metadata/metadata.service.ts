import { Injectable } from '@nestjs/common';
import type { ColumnMetadata, IndexMetadata, SchemaMetadata, TableMetadata, TableStructure } from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import { PgDriver } from '../database/drivers/pg/pg-driver';

interface TableRow {
  table_schema: string;
  table_name: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  is_primary_key: boolean;
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

@Injectable()
export class MetadataService {
  constructor(
    private readonly pool: PoolManager,
    private readonly driver: PgDriver,
  ) {}

  async getSchemas(connectionId: string): Promise<SchemaMetadata[]> {
    const [{ rows: tableRows }, { rows: colRows }] = await Promise.all([
      this.pool.run(connectionId, this.driver.buildListTables()) as unknown as Promise<{ rows: TableRow[] }>,
      this.pool.run(connectionId, this.driver.buildListAllColumns()) as unknown as Promise<{ rows: AllColumnsRow[] }>,
    ]);

    const colMap = new Map<string, ColumnMetadata[]>();
    for (const col of colRows) {
      const key = `${col.table_schema}.${col.table_name}`;
      const list = colMap.get(key) ?? [];
      list.push({ name: col.column_name, dataType: col.data_type, nullable: col.is_nullable === 'YES', isPrimaryKey: col.is_primary_key });
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
    const { rows } = (await this.pool.run(connectionId, this.driver.buildListColumns({ namespace: schema, name: table }))) as unknown as {
      rows: ColumnRow[];
    };

    return rows.map((row) => ({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      isPrimaryKey: row.is_primary_key,
    }));
  }

  async getTableIndexes(connectionId: string, schema: string, table: string): Promise<IndexMetadata[]> {
    const { rows } = (await this.pool.run(connectionId, this.driver.buildListIndexes({ namespace: schema, name: table }))) as unknown as {
      rows: IndexRow[];
    };

    return rows.map((row) => ({
      name: row.name,
      columns: row.columns,
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
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
}
