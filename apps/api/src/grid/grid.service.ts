import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ColumnMetadata, GridResponse, RowDeleteBody, RowFilter, RowInsertBody, RowUpdateBody } from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';
import { PoolManager } from '../database/pool-manager.service';
import type { DbDriver } from '../database/db-driver.interface';
import { compileWhere } from './filter';

const DEFAULT_LIMIT = 100;

export interface GetRowsOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filter?: RowFilter;
}

interface ResolvedTable {
  columns: ColumnMetadata[];
  columnNames: Set<string>;
  primaryKey: string[];
}

@Injectable()
export class GridService {
  constructor(
    private readonly pool: PoolManager,
    private readonly metadataService: MetadataService,
  ) {}

  async getRows(
    connectionId: string,
    schema: string,
    table: string,
    options: GetRowsOptions,
  ): Promise<GridResponse> {
    const driver = await this.pool.driverFor(connectionId);
    const { columns, columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);

    const hasFilter = (options.filter?.conditions.length ?? 0) > 0;
    const { clause: whereClause, params: filterParams } = hasFilter
      ? compileWhere(options.filter!, columns, 0, driver.whereDialect)
      : { clause: '', params: [] };

    const orderColumn =
      options.sortBy && columnNames.has(options.sortBy) ? options.sortBy : primaryKey[0];
    const sortDir = options.sortDir === 'desc' ? 'DESC' : 'ASC';

    const limit = options.limit ?? DEFAULT_LIMIT;
    const offset = options.offset ?? 0;

    const ref = { namespace: schema, name: table };
    const frag = driver.buildSelectRows(ref, {
      whereClause,
      whereParams: filterParams,
      orderColumn,
      sortDir,
      limit,
      offset,
    });
    const { rows } = await this.pool.run(connectionId, frag);

    const totalRows = hasFilter
      ? await this.getFilteredRowCount(connectionId, driver, schema, table, whereClause, filterParams)
      : await this.getApproximateRowCount(connectionId, driver, schema, table);

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
    const driver = await this.pool.driverFor(connectionId);
    const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    if (!columnNames.has(req.column)) {
      throw new UnprocessableEntityException(`Column "${req.column}" does not exist on "${schema}.${table}"`);
    }
    this.assertPrimaryKeyMatches(req.primaryKey, primaryKey, schema, table);

    const frag = driver.buildUpdateRow(
      { namespace: schema, name: table },
      req.column,
      req.value,
      primaryKey,
      primaryKey.map((c) => req.primaryKey[c]),
    );
    const { rows, rowCount } = await this.pool.run(connectionId, frag);
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
    const driver = await this.pool.driverFor(connectionId);
    const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    const entries = Object.entries(req.values).filter(([column]) => columnNames.has(column));

    const frag = driver.buildInsertRow({ namespace: schema, name: table }, entries);
    const { rows } = await this.pool.run(connectionId, frag);
    return rows[0]!;
  }

  /** Deletes a row by primary key, re-validated against live metadata. */
  async deleteRow(connectionId: string, schema: string, table: string, req: RowDeleteBody): Promise<void> {
    const driver = await this.pool.driverFor(connectionId);
    const { primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);
    this.assertPrimaryKeyMatches(req.primaryKey, primaryKey, schema, table);

    const frag = driver.buildDeleteRow(
      { namespace: schema, name: table },
      primaryKey,
      primaryKey.map((c) => req.primaryKey[c]),
    );
    const { rowCount } = await this.pool.run(connectionId, frag);
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

  private async getFilteredRowCount(
    connectionId: string,
    driver: DbDriver,
    schema: string,
    table: string,
    whereClause: string,
    params: unknown[],
  ): Promise<number> {
    const { rows } = await this.pool.run(
      connectionId,
      driver.buildFilteredRowCount({ namespace: schema, name: table }, whereClause, params),
    );
    return parseInt(String((rows[0] as { count?: string | number })?.count ?? '0'), 10);
  }

  private async getApproximateRowCount(connectionId: string, driver: DbDriver, schema: string, table: string): Promise<number> {
    const { rows } = await this.pool.run(
      connectionId,
      driver.buildRowCountEstimate({ namespace: schema, name: table }),
    );
    const estimate = (rows[0] as { reltuples?: number | null })?.reltuples ?? 0;
    return Math.max(0, Math.round(Number(estimate)));
  }
}
