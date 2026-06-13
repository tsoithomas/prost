import { Injectable } from '@nestjs/common';
import type { ColumnMetadata, IndexMetadata, SchemaMetadata, TableStructure, TableSummary } from '@prost/shared-types';
import { PgConnectionService } from '../target-db/pg-connection.service';

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
  constructor(private readonly pgConnectionService: PgConnectionService) {}

  async getSchemas(connectionId: string): Promise<SchemaMetadata[]> {
    const { rows } = await this.pgConnectionService.runParameterized<TableRow>(
      connectionId,
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         AND table_schema NOT LIKE 'pg_toast%'
         AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name`,
    );

    const schemas = new Map<string, TableSummary[]>();
    for (const row of rows) {
      const tables = schemas.get(row.table_schema) ?? [];
      tables.push({ schema: row.table_schema, name: row.table_name });
      schemas.set(row.table_schema, tables);
    }

    return Array.from(schemas.entries()).map(([name, tables]) => ({ name, tables }));
  }

  async getTableColumns(connectionId: string, schema: string, table: string): Promise<ColumnMetadata[]> {
    const { rows } = await this.pgConnectionService.runParameterized<ColumnRow>(
      connectionId,
      `SELECT
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
      [schema, table],
    );

    return rows.map((row) => ({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      isPrimaryKey: row.is_primary_key,
    }));
  }

  async getTableIndexes(connectionId: string, schema: string, table: string): Promise<IndexMetadata[]> {
    const { rows } = await this.pgConnectionService.runParameterized<IndexRow>(
      connectionId,
      `SELECT
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
      [schema, table],
    );

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
