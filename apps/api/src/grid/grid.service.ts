import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import type { ColumnMetadata, GridResponse, RowDeleteBody, RowInsertBody, RowUpdateBody } from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';
import { PgConnectionService } from '../target-db/pg-connection.service';

const DEFAULT_LIMIT = 100;

export interface GetRowsOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

interface ResolvedTable {
  columns: ColumnMetadata[];
  columnNames: Set<string>;
  primaryKey: string[];
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
    const { columns, columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);

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

  /**
   * Single-cell update, keyed by primary key. The PK and column are re-validated against
   * live metadata (architecture principle #4) — the client-supplied `primaryKey` is a
   * locator, never an authorization.
   */
  async updateCell(
    connectionId: string,
    schema: string,
    table: string,
    req: RowUpdateBody,
  ): Promise<Record<string, unknown>> {
    const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    if (!columnNames.has(req.column)) {
      throw new UnprocessableEntityException(`Column "${req.column}" does not exist on "${schema}.${table}"`);
    }
    this.assertPrimaryKeyMatches(req.primaryKey, primaryKey, schema, table);

    const setClause = `${quoteIdent(req.column)} = $1`;
    const whereClause = primaryKey
      .map((column, index) => `${quoteIdent(column)} = $${index + 2}`)
      .join(' AND ');
    const sql = `UPDATE ${quoteIdent(schema)}.${quoteIdent(table)} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    const params = [req.value, ...primaryKey.map((column) => req.primaryKey[column])];

    const { rows, rowCount } = await this.pgConnectionService.runParameterized(connectionId, sql, params);
    if (rowCount !== 1) {
      throw new NotFoundException(
        `Row in "${schema}.${table}" no longer exists — it may have been changed or deleted`,
      );
    }
    return rows[0]!;
  }

  /**
   * Inserts a row. Unknown keys in `values` are dropped rather than trusted; an empty
   * `values` produces `INSERT ... DEFAULT VALUES` so serial PKs / column defaults apply.
   */
  async insertRow(
    connectionId: string,
    schema: string,
    table: string,
    req: RowInsertBody,
  ): Promise<Record<string, unknown>> {
    const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    const entries = Object.entries(req.values).filter(([column]) => columnNames.has(column));

    const sql =
      entries.length === 0
        ? `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} DEFAULT VALUES RETURNING *`
        : `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} (${entries
            .map(([column]) => quoteIdent(column))
            .join(', ')}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`;
    const params = entries.map(([, value]) => value);

    const { rows } = await this.pgConnectionService.runParameterized(connectionId, sql, params);
    return rows[0]!;
  }

  /** Deletes a row by primary key, re-validated against live metadata. */
  async deleteRow(connectionId: string, schema: string, table: string, req: RowDeleteBody): Promise<void> {
    const { primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);
    this.assertPrimaryKeyMatches(req.primaryKey, primaryKey, schema, table);

    const whereClause = primaryKey.map((column, index) => `${quoteIdent(column)} = $${index + 1}`).join(' AND ');
    const sql = `DELETE FROM ${quoteIdent(schema)}.${quoteIdent(table)} WHERE ${whereClause}`;
    const params = primaryKey.map((column) => req.primaryKey[column]);

    const { rowCount } = await this.pgConnectionService.runParameterized(connectionId, sql, params);
    if (rowCount !== 1) {
      throw new NotFoundException(`Row in "${schema}.${table}" no longer exists`);
    }
  }

  private async resolveTable(connectionId: string, schema: string, table: string): Promise<ResolvedTable> {
    const columns = await this.metadataService.getTableColumns(connectionId, schema, table);
    if (columns.length === 0) {
      throw new NotFoundException(`Table "${schema}.${table}" not found`);
    }
    return {
      columns,
      columnNames: new Set(columns.map((column) => column.name)),
      primaryKey: columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
    };
  }

  private assertEditable(primaryKey: string[], schema: string, table: string): void {
    if (primaryKey.length === 0) {
      throw new UnprocessableEntityException(`Table "${schema}.${table}" has no primary key and is not editable`);
    }
  }

  private assertPrimaryKeyMatches(
    provided: Record<string, unknown>,
    expected: string[],
    schema: string,
    table: string,
  ): void {
    const providedKeys = Object.keys(provided);
    const matches =
      providedKeys.length === expected.length && expected.every((column) => providedKeys.includes(column));
    if (!matches) {
      throw new UnprocessableEntityException(
        `Primary key for "${schema}.${table}" must be exactly: ${expected.join(', ')}`,
      );
    }
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
