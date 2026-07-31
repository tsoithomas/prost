import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import type { AuditAction } from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';
import { PoolManager } from '../database/pool-manager.service';
import { AuditService, type AuditRecordBase } from '../audit/audit.service';
import { PreferenceService } from '../preference/preference.service';
import type { DbDriver } from '../database/db-driver.interface';
import type { DriverQueryFn, RowUpdateGuard, TableRef } from '../database/types';
import { compileWhere } from './filter';
import { maskedColumnsFor, redactRows } from './masking';

const DEFAULT_LIMIT = 100;

/** Actor identity threaded from the controller so grid writes can be audited (Phase 28). */
export interface WriteContext {
  userId: string;
  correlationId?: string;
}

/** A value-free statement descriptor for the audit log — identifiers/placeholders only, never values. */
function buildAuditSql(action: AuditAction, schema: string, table: string, columns: string[], pkColumns: string[]): string {
  const target = `${schema}.${table}`;
  const where = pkColumns.length > 0 ? ` WHERE ${pkColumns.map((c) => `${c} = ?`).join(' AND ')}` : '';
  if (action === 'update') return `UPDATE ${target} SET ${columns.map((c) => `${c} = ?`).join(', ')}${where}`;
  if (action === 'insert') return `INSERT INTO ${target} (${columns.join(', ')})`;
  if (action === 'delete') return `DELETE FROM ${target}${where}`;
  return `${action.toUpperCase()} ${target}`;
}

export interface GetRowsOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filter?: RowFilter;
  /** Whose masking preference applies (Phase 39). Omitted = no masking (internal callers). */
  userId?: string;
  /** Per-session opt-out of masking for this read. Audited; never persisted. */
  reveal?: boolean;
}

interface ResolvedTable {
  columns: ColumnMetadata[];
  columnNames: Set<string>;
  primaryKey: string[];
}

@Injectable()
export class GridService {
  private readonly logger = new Logger(GridService.name);

  constructor(
    private readonly pool: PoolManager,
    private readonly metadataService: MetadataService,
    private readonly audit: AuditService,
    private readonly preferences: PreferenceService,
  ) {}

  private auditBase(
    ctx: WriteContext,
    connectionId: string,
    action: AuditAction,
    schema: string,
    table: string,
    sql: string,
  ): AuditRecordBase {
    return {
      userId: ctx.userId,
      connectionId,
      action,
      targetSchema: schema,
      targetTable: table,
      sql,
      correlationId: ctx.correlationId ?? null,
    };
  }

  async getRows(
    connectionId: string,
    schema: string,
    table: string,
    options: GetRowsOptions,
  ): Promise<GridResponse> {
    const driver = await this.pool.driverFor(connectionId);
    const { columns, columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
    const masked = await this.resolveMasked(options.userId, connectionId, schema, table, primaryKey);

    const hasFilter = (options.filter?.conditions.length ?? 0) > 0;
    const { clause: whereClause, params: filterParams } = hasFilter
      ? compileWhere(options.filter!, columns, 0, driver.whereDialect)
      : { clause: '', params: [] };

    const orderColumn =
      options.sortBy && columnNames.has(options.sortBy) ? options.sortBy : primaryKey[0];
    const sortDir = options.sortDir === 'desc' ? 'DESC' : 'ASC';

    const limit = options.limit ?? DEFAULT_LIMIT;
    const offset = options.offset ?? 0;

    // A revealed read returns real values and is audited; every other read redacts before the rows
    // leave the seam, so a masked value never reaches the client (principle §4).
    const redacting = masked.size > 0 && !options.reveal;
    if (masked.size > 0 && options.reveal) {
      await this.recordReveal(options.userId!, connectionId, schema, table, [...masked]);
    }

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
    // FK metadata is table-level (identical for every page) and only the client's first request
    // — offset 0, used to learn the table shape — consumes it, so skip it on later pages to avoid
    // re-running catalog queries per infinite-scroll block. It is also best-effort: a failure must
    // not fail the whole grid, so it degrades to "no relational navigation" rather than no rows.
    const wantForeignKeys = offset === 0;
    const [{ rows }, foreignKeys, referencingKeys] = await Promise.all([
      this.pool.run(connectionId, frag),
      wantForeignKeys
        ? this.bestEffort(`foreign keys for ${schema}.${table}`, () => this.metadataService.getTableForeignKeys(connectionId, schema, table))
        : Promise.resolve(undefined),
      wantForeignKeys
        ? this.bestEffort(`referencing keys for ${schema}.${table}`, () =>
            this.metadataService.getReferencingForeignKeys(connectionId, schema, table),
          )
        : Promise.resolve(undefined),
    ]);

    const totalRows = hasFilter
      ? await this.getFilteredRowCount(connectionId, driver, schema, table, whereClause, filterParams)
      : await this.getApproximateRowCount(connectionId, driver, schema, table);

    return {
      rows: redacting ? redactRows(rows as Record<string, unknown>[], masked) : rows,
      columns,
      totalRows,
      editable,
      sourceTable: `${schema}.${table}`,
      primaryKey,
      concurrency: editable ? driver.capabilities.concurrency : undefined,
      foreignKeys,
      referencingKeys,
      ...(redacting ? { maskedColumns: [...masked] } : {}),
    };
  }

  /**
   * Refuses a write to a masked column (Phase 39). The client reads a mask token, so an edit there
   * would be a blind overwrite of a value the user can't see — the server rejects it rather than
   * relying on a disabled input.
   */
  private async assertNotMasked(
    userId: string,
    connectionId: string,
    schema: string,
    table: string,
    columns: string[],
    primaryKey: readonly string[] = [],
  ): Promise<void> {
    // Same PK exclusion as the read, so a PK the user marked stays editable rather than being
    // shown in the clear but refused on write.
    const masked = await this.resolveMasked(userId, connectionId, schema, table, primaryKey);
    const blocked = columns.filter((column) => masked.has(column));
    if (blocked.length > 0) {
      throw new UnprocessableEntityException(
        `Cannot edit masked ${blocked.length === 1 ? 'column' : 'columns'} ${blocked.map((c) => `"${c}"`).join(', ')} — unmark them as sensitive first`,
      );
    }
  }

  /**
   * The masked columns for this read, or an empty set when no user context / nothing is masked.
   * `primaryKey` columns are excluded — see `maskedColumnsFor`.
   */
  private async resolveMasked(
    userId: string | undefined,
    connectionId: string,
    schema: string,
    table: string,
    primaryKey: readonly string[] = [],
  ): Promise<Set<string>> {
    if (!userId) return new Set();
    const prefs = await this.preferences.get(userId);
    return maskedColumnsFor(prefs.maskedColumns, connectionId, schema, table, primaryKey);
  }

  /**
   * Records that masked columns were shown in the clear (Phase 39). Identifiers only — the audit row
   * names the columns revealed, never a value.
   */
  private async recordReveal(
    userId: string,
    connectionId: string,
    schema: string,
    table: string,
    columns: string[],
  ): Promise<void> {
    await this.audit.withAudit(
      this.auditBase({ userId }, connectionId, 'reveal', schema, table, `REVEAL ${schema}.${table} (${columns.join(', ')})`),
      async () => undefined,
    );
  }

  /** Runs a best-effort metadata load: logs and returns `undefined` on failure instead of throwing. */
  private async bestEffort<T>(label: string, load: () => Promise<T[]>): Promise<T[] | undefined> {
    try {
      return await load();
    } catch (err) {
      this.logger.warn(`Failed to load ${label}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
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
    ctx: WriteContext = { userId: '' },
  ): Promise<Record<string, unknown>> {
    return this.audit.withAudit(
      this.auditBase(ctx, connectionId, 'update', schema, table, buildAuditSql('update', schema, table, [req.column], Object.keys(req.primaryKey))),
      async () => {
        await this.pool.assertWritable(connectionId);
        const driver = await this.pool.driverFor(connectionId);
        const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
        this.assertEditable(primaryKey, schema, table);

        if (!columnNames.has(req.column)) {
          throw new UnprocessableEntityException(`Column "${req.column}" does not exist on "${schema}.${table}"`);
        }
        await this.assertNotMasked(ctx.userId, connectionId, schema, table, [req.column], primaryKey);
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
      },
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
    ctx: WriteContext = { userId: '' },
  ): Promise<BulkRowUpdateResult> {
    const bulkColumns = [...new Set(body.rows.flatMap((row) => row.edits.map((e) => e.column)))];
    const auditSql = `${buildAuditSql('update', schema, table, bulkColumns, [])} (bulk: ${body.rows.length} rows)`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'update', schema, table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      const driver = await this.pool.driverFor(connectionId);
      const { columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
      this.assertEditable(primaryKey, schema, table);

      if (body.rows.length === 0) {
        throw new BadRequestException('No row edits supplied');
      }
      await this.assertNotMasked(ctx.userId, connectionId, schema, table, bulkColumns, primaryKey);

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
          // Engines with RETURNING (PG/SQLite) hand back the refreshed row inline. Engines without
          // it (MySQL) return no rows, so re-read by the row's post-edit primary key.
          updated.push(out[0] ?? (await this.reselectRow(q, driver, ref, primaryKey, pkValues, edits)));
        }
        return updated;
      });

      return { rows };
    });
  }

  /**
   * Re-reads a single row by its primary key after a guarded UPDATE, for engines that lack
   * `RETURNING` (MySQL). Applies any edits that changed a primary-key column so the lookup
   * targets the row's new key.
   */
  private async reselectRow(
    q: DriverQueryFn,
    driver: DbDriver,
    ref: TableRef,
    primaryKey: string[],
    pkValues: unknown[],
    edits: [string, unknown][],
  ): Promise<Record<string, unknown>> {
    const editByColumn = new Map(edits);
    const newPkValues = primaryKey.map((column, i) => (editByColumn.has(column) ? editByColumn.get(column) : pkValues[i]));
    const whereClause = `WHERE ${primaryKey.map((column, i) => `${driver.quoteIdent(column)} = ${driver.placeholder(i + 1)}`).join(' AND ')}`;
    const { rows } = await q(
      driver.buildSelectRows(ref, {
        whereClause,
        whereParams: newPkValues,
        orderColumn: primaryKey[0],
        sortDir: 'ASC',
        limit: 1,
        offset: 0,
      }),
    );
    return rows[0] as Record<string, unknown>;
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
    ctx: WriteContext = { userId: '' },
  ): Promise<Record<string, unknown>> {
    const auditSql = buildAuditSql('insert', schema, table, Object.keys(req.values), []);
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'insert', schema, table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      const driver = await this.pool.driverFor(connectionId);
      const { columns, columnNames, primaryKey } = await this.resolveTable(connectionId, schema, table);
      this.assertEditable(primaryKey, schema, table);

      const entries = Object.entries(req.values).filter(([column]) => columnNames.has(column));

      return this.pool.withTransaction(connectionId, (q) =>
        driver.insertRow(q, { namespace: schema, name: table }, entries, columns),
      );
    });
  }

  /** Deletes a row by primary key, re-validated against live metadata. */
  async deleteRow(
    connectionId: string,
    schema: string,
    table: string,
    req: RowDeleteBody,
    ctx: WriteContext = { userId: '' },
  ): Promise<void> {
    const auditSql = buildAuditSql('delete', schema, table, [], Object.keys(req.primaryKey));
    await this.audit.withAudit(this.auditBase(ctx, connectionId, 'delete', schema, table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
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
    });
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
