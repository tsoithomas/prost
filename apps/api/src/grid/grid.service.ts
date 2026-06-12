import { Injectable, NotFoundException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import type { GridResponse } from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';
import { PgConnectionService } from '../target-db/pg-connection.service';

const DEFAULT_LIMIT = 100;

export interface GetRowsOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

@Injectable()
export class GridService {
  constructor(
    private readonly pgConnectionService: PgConnectionService,
    private readonly metadataService: MetadataService,
  ) {}

  async getRows(
    connectionId: string,
    schema: string,
    table: string,
    options: GetRowsOptions,
  ): Promise<GridResponse> {
    const columns = await this.metadataService.getTableColumns(connectionId, schema, table);
    if (columns.length === 0) {
      throw new NotFoundException(`Table "${schema}.${table}" not found`);
    }

    const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
    const columnNames = new Set(columns.map((column) => column.name));

    const orderColumn =
      options.sortBy && columnNames.has(options.sortBy) ? options.sortBy : primaryKey[0];
    const sortDir = options.sortDir === 'desc' ? 'DESC' : 'ASC';

    const limit = options.limit ?? DEFAULT_LIMIT;
    const offset = options.offset ?? 0;

    let sql = `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)}`;
    if (orderColumn) {
      sql += ` ORDER BY ${quoteIdent(orderColumn)} ${sortDir}`;
    }
    sql += ' LIMIT $1 OFFSET $2';

    const { rows } = await this.pgConnectionService.runParameterized(connectionId, sql, [limit, offset]);
    const totalRows = await this.getApproximateRowCount(connectionId, schema, table);

    return {
      rows,
      columns,
      totalRows,
      editable: primaryKey.length > 0,
      sourceTable: `${schema}.${table}`,
      primaryKey,
    };
  }

  private async getApproximateRowCount(connectionId: string, schema: string, table: string): Promise<number> {
    const { rows } = await this.pgConnectionService.runParameterized<{ reltuples: number | null }>(
      connectionId,
      "SELECT reltuples FROM pg_class WHERE oid = to_regclass(format('%I.%I', $1::text, $2::text))",
      [schema, table],
    );
    const estimate = rows[0]?.reltuples ?? 0;
    return Math.max(0, Math.round(Number(estimate)));
  }
}
