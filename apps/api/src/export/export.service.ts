import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatCsvRow, CSV_ROW_TERMINATOR } from '@prost/utils';
import type { ColumnMetadata } from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import type { DbDriver } from '../database/db-driver.interface';
import type { SqlFragment, TableRef } from '../database/types';
import { compileWhere } from '../grid/filter';
import { maskedColumnsFor, redactRows, tableKey } from '../grid/masking';
import { PreferenceService } from '../preference/preference.service';
import { buildOrderedStatement, QUERY_PAGE_SIZE } from '../query/paging';
import { QueryService } from '../query/query.service';
import { MetadataService } from '../metadata/metadata.service';
import type { ExportDto } from './dto/export.dto';

/** Where an export writes its formatted chunks. The controller adapts an Express `Response`; tests pass a collector. */
export interface ExportWriter {
  write(chunk: string): void;
}

/** A single table target for the SQL dump. */
export interface SqlExportTable {
  schema: string;
  table: string;
}

/** Discriminated by `kind`: the CSV/JSON single-statement path, or the SQL multi-table dump path. */
export type PreparedExport =
  | {
      kind: 'rows';
      frag: SqlFragment;
      format: 'csv' | 'json';
      delimiter?: string;
      nullToken?: string | null;
      filename: string;
      /**
       * Columns to redact before writing (Phase 39). Resolved at prepare time from the caller's
       * masking preference; empty for a query-scope export, which has no stable table to key on.
       */
      masked: Set<string>;
    }
  | {
      kind: 'sql';
      tables: SqlExportTable[];
      includeSchema: boolean;
      includeData: boolean;
      filename: string;
      /** Per-table masked columns, keyed `"schema.table"` (Phase 39). */
      maskedByTable: Map<string, Set<string>>;
    };

export interface ExportResult {
  rowCount: number;
  truncated: boolean;
}

/** Rows per multi-row `INSERT` statement in a SQL dump (bigger = fewer, larger statements). */
const INSERT_BATCH_ROWS = 100;

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly maxRows: number;

  constructor(
    private readonly pool: PoolManager,
    private readonly metadata: MetadataService,
    private readonly queryService: QueryService,
    private readonly preferences: PreferenceService,
    config: ConfigService,
  ) {
    // Shares the streaming row budget with the Phase 22 cursor (principle §7).
    this.maxRows = Number(config.get('STREAM_MAX_ROWS') ?? 100_000);
  }

  /**
   * Validate the request and build what will be streamed — everything that can produce a clean error
   * (unknown table, non-SELECT query, bad filter, unsupported engine, `sql`+`query`) happens here,
   * before the controller writes any bytes. Touches the DB only for metadata lookups.
   */
  async prepare(connectionId: string, dto: ExportDto, userId?: string): Promise<PreparedExport> {
    const driver = await this.pool.driverFor(connectionId);
    if (!driver.capabilities.supportsCursors) {
      throw new BadRequestException('Streaming export is not supported for this engine');
    }

    const stamp = new Date().toISOString().slice(0, 10);

    if (dto.format === 'sql') {
      return this.prepareSql(connectionId, dto, stamp, userId);
    }
    if (dto.scope === 'schema') {
      throw new BadRequestException('The schema scope requires the sql format');
    }

    const sortDir = dto.sortDir === 'desc' ? 'DESC' : 'ASC';
    let frag: SqlFragment;
    let base: string;

    if (dto.scope === 'table') {
      if (!dto.schema || !dto.table) {
        throw new BadRequestException('schema and table are required for a table export');
      }
      const columns = await this.metadata.getTableColumns(connectionId, dto.schema, dto.table);
      if (columns.length === 0) {
        throw new NotFoundException(`Table "${dto.schema}.${dto.table}" not found`);
      }
      const columnNames = new Set(columns.map((c) => c.name));
      const primaryKey = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

      const hasFilter = (dto.filter?.conditions.length ?? 0) > 0;
      const { clause: whereClause, params: whereParams } = hasFilter
        ? compileWhere(dto.filter!, columns, 0, driver.whereDialect)
        : { clause: '', params: [] };

      const orderColumn = dto.sortBy && columnNames.has(dto.sortBy) ? dto.sortBy : primaryKey[0];

      frag = driver.buildSelectRows(
        { namespace: dto.schema, name: dto.table },
        { whereClause, whereParams, orderColumn, sortDir, limit: this.maxRows + 1, offset: 0, includeVersion: false },
      );
      base = dto.table;
    } else {
      if (!dto.sql) throw new BadRequestException('sql is required for a query export');
      const statementText = await this.queryService.resolveSingleSelect(connectionId, dto.sql);
      const cursorSql = dto.sortBy
        ? buildOrderedStatement(statementText, {
            column: dto.sortBy,
            dir: dto.sortDir ?? 'asc',
            quoteIdent: (id) => driver.quoteIdent(id),
          })
        : statementText;
      frag = { sql: cursorSql, params: [] };
      base = 'query';
    }

    // A query-scope export has no stable source table, so nothing is masked — the same boundary the
    // SQL editor has: masking covers table browsing and table exports, not ad-hoc SQL.
    const masked =
      dto.scope === 'table' && dto.schema && dto.table
        ? await this.resolveMasked(userId, connectionId, dto.schema, dto.table)
        : new Set<string>();

    return {
      kind: 'rows',
      frag,
      format: dto.format,
      delimiter: dto.delimiter,
      nullToken: dto.nullToken,
      filename: `${sanitizeFilename(base)}-${stamp}.${dto.format}`,
      masked,
    };
  }

  /**
   * The caller's masked columns for one table; empty without a user context (internal callers).
   * Primary-key columns are never masked (see `maskedColumnsFor`) — beyond matching what the grid
   * shows, a SQL dump with a redacted key would emit INSERTs that can't be replayed.
   */
  private async resolveMasked(
    userId: string | undefined,
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<Set<string>> {
    if (!userId) return new Set();
    const [prefs, columns] = await Promise.all([
      this.preferences.get(userId),
      this.metadata.getTableColumns(connectionId, schema, table),
    ]);
    const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
    return maskedColumnsFor(prefs.maskedColumns, connectionId, schema, table, primaryKey);
  }

  /** Validate a SQL dump request (single table or a multi-table schema) and resolve its table list. */
  private async prepareSql(
    connectionId: string,
    dto: ExportDto,
    stamp: string,
    userId?: string,
  ): Promise<PreparedExport> {
    if (dto.scope === 'query') {
      throw new BadRequestException('SQL export is not available for a query result (no target table)');
    }
    if (!dto.schema) throw new BadRequestException('schema is required for a SQL export');

    let tableNames: string[];
    let base: string;
    if (dto.scope === 'schema') {
      if (!dto.tables || dto.tables.length === 0) {
        throw new BadRequestException('Select at least one table to export');
      }
      tableNames = dto.tables;
      base = dto.schema;
    } else {
      if (!dto.table) throw new BadRequestException('table is required for a table export');
      tableNames = [dto.table];
      base = dto.table;
    }

    // Validate each table exists (columns non-empty) before any bytes are written.
    const maskedByTable = new Map<string, Set<string>>();
    for (const table of tableNames) {
      const columns = await this.metadata.getTableColumns(connectionId, dto.schema, table);
      if (columns.length === 0) throw new NotFoundException(`Table "${dto.schema}.${table}" not found`);
      maskedByTable.set(tableKey(dto.schema, table), await this.resolveMasked(userId, connectionId, dto.schema, table));
    }

    return {
      kind: 'sql',
      tables: tableNames.map((table) => ({ schema: dto.schema!, table })),
      includeSchema: dto.includeSchema ?? true,
      includeData: dto.includeData ?? true,
      filename: `${sanitizeFilename(base)}-${stamp}.sql`,
      maskedByTable,
    };
  }

  /** Stream the prepared export to `writer`; always closes any cursor it opens. */
  async stream(writer: ExportWriter, connectionId: string, prepared: PreparedExport): Promise<ExportResult> {
    if (prepared.kind === 'sql') return this.streamSql(writer, connectionId, prepared);
    return this.streamRows(writer, connectionId, prepared);
  }

  /** CSV/JSON: one bound statement streamed through a forward-only cursor (Phase 30). */
  private async streamRows(
    writer: ExportWriter,
    connectionId: string,
    prepared: Extract<PreparedExport, { kind: 'rows' }>,
  ): Promise<ExportResult> {
    const cursor = await this.pool.openCursor(connectionId, prepared.frag);
    let rowCount = 0;
    let truncated = false;
    let headerWritten = false;

    try {
      if (prepared.format === 'json') writer.write('[');

      for (;;) {
        const remaining = this.maxRows - rowCount;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const blockSize = Math.min(QUERY_PAGE_SIZE, remaining);
        const { rows, complete } = await cursor.fetch(blockSize);

        if (!headerWritten && prepared.format === 'csv') {
          const columnNames = cursor.columns().map((c) => c.name);
          writer.write(formatCsvRow(columnNames, this.csvOptions(prepared)) + CSV_ROW_TERMINATOR);
          headerWritten = true;
        }

        // Redact before anything is written, so a masked value never reaches the file (Phase 39).
        const safeRows = redactRows(rows, prepared.masked);
        for (const row of safeRows) {
          if (prepared.format === 'csv') {
            const values = cursor.columns().map((c) => row[c.name]);
            writer.write(formatCsvRow(values, this.csvOptions(prepared)) + CSV_ROW_TERMINATOR);
          } else {
            writer.write((rowCount > 0 ? ',' : '') + JSON.stringify(row));
          }
          rowCount += 1;
        }

        if (complete) break;
        if (rowCount >= this.maxRows) {
          truncated = true;
          break;
        }
      }

      if (prepared.format === 'json') writer.write(']');
      else if (truncated) writer.write(`# truncated at ${rowCount} rows${CSV_ROW_TERMINATOR}`);

      return { rowCount, truncated };
    } finally {
      await cursor.close().catch((error) =>
        this.logger.warn(`export cursor close failed connectionId=${connectionId} error=${error instanceof Error ? error.message : 'unknown'}`),
      );
    }
  }

  /** SQL dump: loop the selected tables, emitting optional CREATE TABLE DDL then batched INSERTs. */
  private async streamSql(
    writer: ExportWriter,
    connectionId: string,
    prepared: Extract<PreparedExport, { kind: 'sql' }>,
  ): Promise<ExportResult> {
    const driver = await this.pool.driverFor(connectionId);
    const q = (frag: SqlFragment) => this.pool.run(connectionId, frag);
    let total = 0;
    let anyTruncated = false;

    writer.write(`-- Prost SQL export — ${new Date().toISOString()}\n\n`);

    for (const { schema, table } of prepared.tables) {
      const ref: TableRef = { namespace: schema, name: table };
      writer.write(`-- ${schema}.${table}\n`);

      if (prepared.includeSchema) {
        const structure = await this.metadata.getTableStructure(connectionId, schema, table);
        const ddl = await driver.buildTableDdl(q, ref, structure);
        writer.write(`${ddl.trimEnd()}\n\n`);
      }

      if (prepared.includeData) {
        const columns = await this.metadata.getTableColumns(connectionId, schema, table);
        const masked = prepared.maskedByTable.get(tableKey(schema, table)) ?? new Set<string>();
        const { rowCount, truncated } = await this.streamTableInserts(writer, connectionId, driver, ref, columns, masked);
        total += rowCount;
        anyTruncated = anyTruncated || truncated;
        writer.write('\n');
      }
    }

    return { rowCount: total, truncated: anyTruncated };
  }

  /** Streams one table's rows as batched multi-row INSERT statements, bounded by the row budget. */
  private async streamTableInserts(
    writer: ExportWriter,
    connectionId: string,
    driver: DbDriver,
    ref: TableRef,
    columns: ColumnMetadata[],
    masked: Set<string>,
  ): Promise<ExportResult> {
    const frag = driver.buildSelectRows(ref, {
      whereClause: '',
      whereParams: [],
      orderColumn: columns.find((c) => c.isPrimaryKey)?.name,
      sortDir: 'ASC',
      limit: this.maxRows + 1,
      offset: 0,
      includeVersion: false,
    });
    const header = `INSERT INTO ${driver.qualifyTable(ref)} (${columns.map((c) => driver.quoteIdent(c.name)).join(', ')}) VALUES`;

    const cursor = await this.pool.openCursor(connectionId, frag);
    let rowCount = 0;
    let truncated = false;
    let batch: string[] = [];

    const flush = (): void => {
      if (batch.length === 0) return;
      writer.write(`${header}\n${batch.join(',\n')};\n`);
      batch = [];
    };

    try {
      for (;;) {
        const remaining = this.maxRows - rowCount;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const blockSize = Math.min(QUERY_PAGE_SIZE, remaining);
        const { rows, complete } = await cursor.fetch(blockSize);

        for (const row of redactRows(rows, masked)) {
          batch.push(`  (${columns.map((c) => driver.formatLiteral(row[c.name], c)).join(', ')})`);
          rowCount += 1;
          if (batch.length >= INSERT_BATCH_ROWS) flush();
        }

        if (complete) break;
        if (rowCount >= this.maxRows) {
          truncated = true;
          break;
        }
      }
      flush();
      if (truncated) writer.write(`-- truncated at ${rowCount} rows\n`);
      return { rowCount, truncated };
    } finally {
      await cursor.close().catch((error) =>
        this.logger.warn(`export cursor close failed connectionId=${connectionId} error=${error instanceof Error ? error.message : 'unknown'}`),
      );
    }
  }

  private csvOptions(prepared: Extract<PreparedExport, { kind: 'rows' }>): { delimiter?: string; nullToken?: string | null } {
    return {
      ...(prepared.delimiter ? { delimiter: prepared.delimiter } : {}),
      ...(prepared.nullToken !== undefined ? { nullToken: prepared.nullToken } : {}),
    };
  }
}

/** Keep a download filename to a safe, boring set of characters. */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'export';
}
