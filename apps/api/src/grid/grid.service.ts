import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  BulkRowEdit,
  BulkRowUpdateBody,
  BulkRowUpdateResult,
  ColumnMetadata,
  GridResponse,
  RowDeleteBody,
  RowFilter,
  RowInsertBody,
  RowUpdateBody,
} from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';
import { PoolManager } from '../database/pool-manager.service';
import type { DbDriver } from '../database/db-driver.interface';
import type { RowUpdateGuard } from '../database/types';
import { isSystemConnectionId } from '../connections/system-connection';
import { compileWhere } from './filter';

/** Throws if the connection is read-only (the app-DB self-connection). Belt-and-braces alongside the read-only SQLite handle. */
function assertWritable(connectionId: string): void {
  if (isSystemConnectionId(connectionId)) {
    throw new ForbiddenException('This connection is read-only');
  }
}

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

    const editable = primaryKey.length > 0;
    const ref = { namespace: schema, name: table };
    const frag = driver.buildSelectRows(ref, {
      whereClause,
      whereParams: filterParams,
      orderColumn,
      sortDir,
      limit,
      offset,
      // Token-concurrency engines (PG) project a per-row version we hand back to the client.
      includeVersion: editable && driver.capabilities.concurrency === 'token',
    });
    const { rows } = await this.pool.run(connectionId, frag);

    const totalRows = hasFilter
      ? await this.getFilteredRowCount(connectionId, driver, schema, table, whereClause, filterParams)
      : await this.getApproximateRowCount(connectionId, driver, schema, table);

    return {
      rows,
      columns,
      totalRows,
      editable,
      sourceTable: `${schema}.${table}`,
      primaryKey,
      concurrency: editable ? driver.capabilities.concurrency : undefined,
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
    assertWritable(connectionId);
    const driver = await this.pool.driverFor(connectionId);
    const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    if (!columnNames.has(req.column)) {
      throw new UnprocessableEntityException(`Column "${req.column}" does not exist on "${schema}.${table}"`);
    }
    this.assertPrimaryKeyMatches(req.primaryKey, primaryKey, schema, table);

    return this.pool.withTransaction(connectionId, (q) =>
      driver.updateRow(
        q,
        { namespace: schema, name: table },
        req.column,
        req.value,
        primaryKey,
        primaryKey.map((c) => req.primaryKey[c]),
      ),
    );
  }

  /**
   * Applies a batch of per-row edits in a single transaction (all-or-nothing). Each row update is
   * guarded by an optimistic-concurrency predicate (PG `xmin` token, or the edited columns'
   * pre-image elsewhere); a stale row matches zero rows and aborts the whole batch with a 409
   * conflict naming it. PK and columns are re-validated against live metadata (principle #4).
   */
  async bulkUpdate(
    connectionId: string,
    schema: string,
    table: string,
    body: BulkRowUpdateBody,
  ): Promise<BulkRowUpdateResult> {
    assertWritable(connectionId);
    const driver = await this.pool.driverFor(connectionId);
    const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    if (body.rows.length === 0) {
      throw new BadRequestException('No row edits supplied');
    }

    const ref = { namespace: schema, name: table };
    const prepared = body.rows.map((row) => ({
      pkValues: this.validateBulkRow(row, columnNames, primaryKey, schema, table),
      edits: row.edits.map((e) => [e.column, e.value] as [string, unknown]),
      guard: this.resolveGuard(row, columnNames, schema, table),
    }));

    const rows = await this.pool.withTransaction(connectionId, async (q) => {
      const updated: Record<string, unknown>[] = [];
      for (const { pkValues, edits, guard } of prepared) {
        const frag = driver.buildUpdateRowGuarded(ref, edits, primaryKey, pkValues, guard);
        const { rows: out, rowCount } = await q(frag);
        if (rowCount !== 1) {
          throw new ConflictException(
            `Row in "${schema}.${table}" changed since you loaded it — nothing was saved. Refresh and retry.`,
          );
        }
        updated.push(out[0]!);
      }
      return updated;
    });

    return { rows };
  }

  /** Validates a single bulk edit's PK + columns; returns the PK values in PK-column order. */
  private validateBulkRow(
    row: BulkRowEdit,
    columnNames: Set<string>,
    primaryKey: string[],
    schema: string,
    table: string,
  ): unknown[] {
    this.assertPrimaryKeyMatches(row.primaryKey, primaryKey, schema, table);
    if (row.edits.length === 0) {
      throw new BadRequestException(`No column edits supplied for a row in "${schema}.${table}"`);
    }
    for (const { column } of row.edits) {
      if (!columnNames.has(column)) {
        throw new UnprocessableEntityException(`Column "${column}" does not exist on "${schema}.${table}"`);
      }
    }
    return primaryKey.map((c) => row.primaryKey[c]);
  }

  /** Builds the concurrency guard from the client's `version`/`expected`, re-validating columns. */
  private resolveGuard(
    row: BulkRowEdit,
    columnNames: Set<string>,
    schema: string,
    table: string,
  ): RowUpdateGuard {
    if (row.version !== undefined) {
      return { kind: 'version', value: row.version };
    }
    if (row.expected !== undefined) {
      const entries = Object.entries(row.expected);
      if (entries.length === 0) {
        throw new BadRequestException(`Concurrency guard for "${schema}.${table}" is empty`);
      }
      for (const [column] of entries) {
        if (!columnNames.has(column)) {
          throw new UnprocessableEntityException(`Column "${column}" does not exist on "${schema}.${table}"`);
        }
      }
      return { kind: 'preimage', columns: entries.map(([c]) => c), values: entries.map(([, v]) => v) };
    }
    throw new BadRequestException(
      `Row edit for "${schema}.${table}" is missing a concurrency guard (version or expected)`,
    );
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
    assertWritable(connectionId);
    const driver = await this.pool.driverFor(connectionId);
    const { columns, columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    this.assertEditable(primaryKey, schema, table);

    const entries = Object.entries(req.values).filter(([column]) => columnNames.has(column));

    return this.pool.withTransaction(connectionId, (q) =>
      driver.insertRow(q, { namespace: schema, name: table }, entries, columns),
    );
  }

  /** Deletes a row by primary key, re-validated against live metadata. */
  async deleteRow(connectionId: string, schema: string, table: string, req: RowDeleteBody): Promise<void> {
    assertWritable(connectionId);
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
