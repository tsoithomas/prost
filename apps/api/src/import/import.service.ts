import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ImportBatchRequest,
  ImportBatchResponse,
  ImportPreviewRequest,
  ImportPreviewResponse,
} from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';
import { PoolManager } from '../database/pool-manager.service';
import { AuditService, type AuditRecordBase } from '../audit/audit.service';

/** Actor identity threaded from the controller so import writes are audited (Phase 28). */
export interface ImportContext {
  userId: string;
  correlationId?: string;
}

/** Hard cap on rows per batch (principle §7) — the client streams the file and sends bounded batches. */
const MAX_IMPORT_BATCH_ROWS = 1000;

@Injectable()
export class ImportService {
  constructor(
    private readonly pool: PoolManager,
    private readonly metadata: MetadataService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validate a mapping against live metadata and return the parameterized INSERT shape — no execution.
   * Unlike the batch path, blocking problems come back as `issues` (for display) rather than throwing,
   * so the wizard can show them inline; `sql` is best-effort (empty when the mapping can't form one).
   */
  async preview(connectionId: string, req: ImportPreviewRequest): Promise<ImportPreviewResponse> {
    await this.pool.assertWritable(connectionId);
    const driver = await this.pool.driverFor(connectionId);
    const known = await this.tableColumnNames(connectionId, req.schema, req.table);

    const issues = this.validateColumns(req.columns, known);
    if (issues.length > 0) return { sql: '', issues };

    // Build the shape from the column list (placeholders only — values never appear).
    const entries = req.columns.map((column) => [column, null] as [string, unknown]);
    const { sql } = driver.buildInsertRow({ namespace: req.schema, name: req.table }, entries);
    return { sql, issues: [] };
  }

  /**
   * Insert one batch atomically (all-or-nothing in a single transaction). Rejects a read-only
   * connection, an unknown/duplicate column, a bad row shape, or an over-cap batch *before* any insert;
   * a DB error mid-batch rolls the whole batch back. Uses `buildInsertRow` + the raw transactional `q`
   * (not `insertRow`) so it doesn't trigger MySQL's per-row re-select / strict PK gate — import rows
   * legitimately omit AUTO_INCREMENT keys and we don't need the row back.
   */
  async batch(connectionId: string, req: ImportBatchRequest, ctx: ImportContext): Promise<ImportBatchResponse> {
    const auditSql = `INSERT INTO ${req.schema}.${req.table} (${req.columns.join(', ')})`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);

      if (req.rows.length === 0) throw new BadRequestException('Import batch has no rows');
      if (req.rows.length > MAX_IMPORT_BATCH_ROWS) {
        throw new BadRequestException(`Import batch exceeds the ${MAX_IMPORT_BATCH_ROWS}-row limit`);
      }

      const driver = await this.pool.driverFor(connectionId);
      const known = await this.tableColumnNames(connectionId, req.schema, req.table);
      const issues = this.validateColumns(req.columns, known);
      if (issues.length > 0) throw new BadRequestException(issues.join('; '));

      req.rows.forEach((row, i) => {
        if (!Array.isArray(row) || row.length !== req.columns.length) {
          throw new BadRequestException(`Row ${i + 1} has ${Array.isArray(row) ? row.length : 0} value(s), expected ${req.columns.length}`);
        }
      });

      const ref = { namespace: req.schema, name: req.table };
      await this.pool.withTransaction(connectionId, async (q) => {
        for (const row of req.rows) {
          const entries = req.columns.map((column, i) => [column, row[i]] as [string, unknown]);
          await q(driver.buildInsertRow(ref, entries));
        }
      });

      return { inserted: req.rows.length };
    });
  }

  private async tableColumnNames(connectionId: string, schema: string, table: string): Promise<Set<string>> {
    const columns = await this.metadata.getTableColumns(connectionId, schema, table);
    if (columns.length === 0) throw new NotFoundException(`Table "${schema}.${table}" not found`);
    return new Set(columns.map((c) => c.name));
  }

  /** Returns a list of blocking problems (empty = valid): duplicates or columns absent from the table. */
  private validateColumns(columns: string[], known: Set<string>): string[] {
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const column of columns) {
      if (seen.has(column)) issues.push(`Duplicate target column "${column}"`);
      seen.add(column);
      if (!known.has(column)) issues.push(`Unknown column "${column}"`);
    }
    return issues;
  }

  private auditBase(ctx: ImportContext, connectionId: string, schema: string, table: string, sql: string): AuditRecordBase {
    return {
      userId: ctx.userId,
      connectionId,
      action: 'import',
      targetSchema: schema,
      targetTable: table,
      sql,
      correlationId: ctx.correlationId ?? null,
    };
  }
}
