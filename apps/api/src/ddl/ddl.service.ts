import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AlterTableRequest,
  AlterTableResult,
  CreateIndexRequest,
  CreateIndexResult,
  CreateTableRequest,
  CreateTableResult,
  DdlPreviewRequest,
  DdlPreviewResult,
  DropIndexRequest,
  DropIndexResult,
  DropTableRequest,
  DropTableResult,
  TruncateTableRequest,
  TruncateTableResult,
} from '@prost/shared-types';
import type { AuditAction } from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import { MetadataService } from '../metadata/metadata.service';
import { AuditService, type AuditRecordBase } from '../audit/audit.service';

/** Actor identity threaded from the controller so DDL can be audited (Phase 28). */
export interface WriteContext {
  userId: string;
  correlationId?: string;
}

@Injectable()
export class DdlService {
  constructor(
    private readonly pool: PoolManager,
    private readonly metadataService: MetadataService,
    private readonly audit: AuditService,
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

  async createTable(connectionId: string, req: CreateTableRequest, ctx: WriteContext = { userId: '' }): Promise<CreateTableResult> {
    const auditSql = `CREATE TABLE ${req.schema}.${req.table} (${req.columns.map((c) => c.name).join(', ')})`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'ddl', req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      if (req.columns.length === 0) {
        throw new UnprocessableEntityException('At least one column is required');
      }

      const names = req.columns.map((c) => c.name);
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      if (duplicates.length > 0) {
        throw new UnprocessableEntityException(`Duplicate column name: "${duplicates[0]}"`);
      }

      const driver = await this.pool.driverFor(connectionId);
      const normalized = driver.normalizeCreateTable(req);
      const frag = driver.buildCreateTable(normalized);

      try {
        await this.pool.run(connectionId, frag);
      } catch (err: unknown) {
        driver.mapError(err, { operation: 'createTable', detail: `Table "${req.schema}"."${req.table}" already exists` });
        throw err;
      }

      return { schema: req.schema, table: req.table, sql: frag.sql };
    });
  }

  async alterTable(connectionId: string, req: AlterTableRequest, ctx: WriteContext = { userId: '' }): Promise<AlterTableResult> {
    const auditSql = `ALTER TABLE ${req.schema}.${req.table} (${req.operation.kind})`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'ddl', req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      const driver = await this.pool.driverFor(connectionId);
      const structure = await this.metadataService.getTableStructure(connectionId, req.schema, req.table);
      const normalizedOp = driver.normalizeAlterTable(
        { namespace: req.schema, name: req.table },
        req.operation,
        structure.columns,
      );
      const frag = driver.buildAlterTable({ namespace: req.schema, name: req.table }, normalizedOp);

      try {
        await this.pool.run(connectionId, frag);
      } catch (err: unknown) {
        driver.mapError(err, { operation: 'alterTable' });
        throw err;
      }

      return { schema: req.schema, table: req.table, sql: frag.sql };
    });
  }

  async createIndex(connectionId: string, req: CreateIndexRequest, ctx: WriteContext = { userId: '' }): Promise<CreateIndexResult> {
    const auditSql = `CREATE INDEX ON ${req.schema}.${req.table} (${req.columns.join(', ')})`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'ddl', req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      const cols = await this.metadataService.getTableColumns(connectionId, req.schema, req.table);
      if (req.columns.length === 0) {
        throw new UnprocessableEntityException('At least one column is required for an index');
      }
      const colNames = new Set(cols.map((c) => c.name));
      for (const col of req.columns) {
        if (!colNames.has(col)) {
          throw new UnprocessableEntityException(`Column "${col}" does not exist`);
        }
      }

      const driver = await this.pool.driverFor(connectionId);
      const { request, name, method } = driver.normalizeCreateIndex(req);
      const frag = driver.buildCreateIndex(request, name, method);

      try {
        await this.pool.run(connectionId, frag);
      } catch (err: unknown) {
        driver.mapError(err, { operation: 'createIndex' });
        throw err;
      }

      return { schema: req.schema, table: req.table, name, sql: frag.sql };
    });
  }

  async dropIndex(connectionId: string, req: DropIndexRequest, ctx: WriteContext = { userId: '' }): Promise<DropIndexResult> {
    const auditSql = `DROP INDEX ${req.index} ON ${req.schema}.${req.table}`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'ddl', req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      const structure = await this.metadataService.getTableStructure(connectionId, req.schema, req.table);
      const exists = structure.indexes.some((idx) => idx.name === req.index);
      if (!exists) {
        throw new UnprocessableEntityException(`Index "${req.index}" does not exist on "${req.schema}"."${req.table}"`);
      }

      const driver = await this.pool.driverFor(connectionId);
      const frag = driver.buildDropIndex({ namespace: req.schema, name: req.index }, req.index);

      try {
        await this.pool.run(connectionId, frag);
      } catch (err: unknown) {
        driver.mapError(err, { operation: 'dropIndex' });
        throw err;
      }

      return { schema: req.schema, index: req.index, sql: frag.sql };
    });
  }

  /** Asserts the table exists (resolves to ≥1 column) or throws NotFoundException. */
  private async assertTableExists(connectionId: string, schema: string, table: string): Promise<void> {
    const columns = await this.metadataService.getTableColumns(connectionId, schema, table);
    if (columns.length === 0) {
      throw new NotFoundException(`Table "${schema}"."${table}" does not exist`);
    }
  }

  async dropTable(connectionId: string, req: DropTableRequest, ctx: WriteContext = { userId: '' }): Promise<DropTableResult> {
    const auditSql = `DROP TABLE ${req.schema}.${req.table}`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'ddl', req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      await this.assertTableExists(connectionId, req.schema, req.table);

      const driver = await this.pool.driverFor(connectionId);
      const frag = driver.buildDropTable({ namespace: req.schema, name: req.table });

      try {
        await this.pool.run(connectionId, frag);
      } catch (err: unknown) {
        driver.mapError(err, { operation: 'dropTable' });
        throw err;
      }

      return { schema: req.schema, table: req.table, sql: frag.sql };
    });
  }

  async truncateTable(connectionId: string, req: TruncateTableRequest, ctx: WriteContext = { userId: '' }): Promise<TruncateTableResult> {
    const auditSql = `TRUNCATE TABLE ${req.schema}.${req.table}`;
    return this.audit.withAudit(this.auditBase(ctx, connectionId, 'truncate', req.schema, req.table, auditSql), async () => {
      await this.pool.assertWritable(connectionId);
      await this.assertTableExists(connectionId, req.schema, req.table);

      const driver = await this.pool.driverFor(connectionId);
      const frag = driver.buildTruncateTable({ namespace: req.schema, name: req.table });

      try {
        await this.pool.run(connectionId, frag);
      } catch (err: unknown) {
        driver.mapError(err, { operation: 'truncateTable' });
        throw err;
      }

      return { schema: req.schema, table: req.table, sql: frag.sql };
    });
  }

  async preview(connectionId: string, req: DdlPreviewRequest): Promise<DdlPreviewResult> {
    await this.pool.assertWritable(connectionId);
    const driver = await this.pool.driverFor(connectionId);

    switch (req.kind) {
      case 'createTable': {
        const r = req.request;
        if (r.columns.length === 0) {
          throw new UnprocessableEntityException('At least one column is required');
        }
        const names = r.columns.map((c) => c.name);
        const duplicate = names.find((name, index) => names.indexOf(name) !== index);
        if (duplicate) {
          throw new UnprocessableEntityException(`Duplicate column name: "${duplicate}"`);
        }
        const frag = driver.buildCreateTable(driver.normalizeCreateTable(r));
        return { sql: frag.sql };
      }
      case 'alterTable': {
        const r = req.request;
        const structure = await this.metadataService.getTableStructure(connectionId, r.schema, r.table);
        const operation = driver.normalizeAlterTable(
          { namespace: r.schema, name: r.table },
          r.operation,
          structure.columns,
        );
        const frag = driver.buildAlterTable({ namespace: r.schema, name: r.table }, operation);
        return { sql: frag.sql };
      }
      case 'createIndex': {
        const r = req.request;
        const columns = await this.metadataService.getTableColumns(connectionId, r.schema, r.table);
        if (r.columns.length === 0) {
          throw new UnprocessableEntityException('At least one column is required for an index');
        }
        const columnNames = new Set(columns.map((column) => column.name));
        for (const column of r.columns) {
          if (!columnNames.has(column)) {
            throw new UnprocessableEntityException(`Column "${column}" does not exist`);
          }
        }
        const { request, name, method } = driver.normalizeCreateIndex(r);
        const frag = driver.buildCreateIndex(request, name, method);
        return { sql: frag.sql };
      }
      case 'dropIndex': {
        const r = req.request;
        const structure = await this.metadataService.getTableStructure(connectionId, r.schema, r.table);
        if (!structure.indexes.some((index) => index.name === r.index)) {
          throw new UnprocessableEntityException(`Index "${r.index}" does not exist on "${r.schema}"."${r.table}"`);
        }
        const frag = driver.buildDropIndex({ namespace: r.schema, name: r.index }, r.index);
        return { sql: frag.sql };
      }
      case 'dropTable': {
        const r = req.request;
        await this.assertTableExists(connectionId, r.schema, r.table);
        const frag = driver.buildDropTable({ namespace: r.schema, name: r.table });
        return { sql: frag.sql };
      }
      case 'truncateTable': {
        const r = req.request;
        await this.assertTableExists(connectionId, r.schema, r.table);
        const frag = driver.buildTruncateTable({ namespace: r.schema, name: r.table });
        return { sql: frag.sql };
      }
    }
  }
}
