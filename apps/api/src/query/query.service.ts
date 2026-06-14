import { BadRequestException, Injectable } from '@nestjs/common';
import { Parser } from 'node-sql-parser';
import type { ColumnMetadata, QueryResult } from '@prost/shared-types';
import { HistoryService } from '../history/history.service';
import { MetadataService } from '../metadata/metadata.service';
import { PgConnectionService } from '../target-db/pg-connection.service';
import { analyzeEditability, extractSingleTable, type EditabilityResult, type ParsedStatement } from './editability';
import { buildPagedQuery, looksLikeSingleSelect, QUERY_PAGE_SIZE } from './paging';

interface FieldInfo {
  name: string;
  dataTypeID: number;
}

/**
 * Executes arbitrary SQL against a target connection and classifies the result (architecture
 * principle §10 — `QueryModule` is its own bounded module). A single `SELECT` is paged via
 * `buildPagedQuery` and run through the editability analyzer; anything else (non-`SELECT`,
 * multi-statement, or unparseable input) is executed as-is and returns an affected-row
 * summary rather than a grid (spec §6.7, Decision 4).
 */
@Injectable()
export class QueryService {
  private readonly parser = new Parser();

  constructor(
    private readonly pgConnectionService: PgConnectionService,
    private readonly metadataService: MetadataService,
    private readonly historyService: HistoryService,
  ) {}

  async execute(connectionId: string, sql: string, userId: string): Promise<QueryResult> {
    const statements = this.parseStatements(sql);

    // Phase 16 lifts this guard to support multi-statement scripts and transactions.
    if (statements.length > 1) {
      throw new BadRequestException('Run one statement at a time — multi-statement execution is not yet supported');
    }

    const isSingleSelect = statements.length === 1 && statements[0]?.type === 'select';
    const isUnparsedSelect = statements.length === 0 && looksLikeSingleSelect(sql);

    const result = isSingleSelect
      ? await this.executeSelect(connectionId, sql, statements)
      : isUnparsedSelect
        ? await this.executeUnparsedSelect(connectionId, sql)
        : await this.executeOther(connectionId, sql);

    await this.historyService.record({ userId, connectionId, sql });

    return result;
  }

  /** `node-sql-parser` throws on input it can't parse — fall back to executing it as-is and let Postgres report the error. */
  private parseStatements(sql: string): ParsedStatement[] {
    try {
      const ast = this.parser.astify(sql, { database: 'postgresql' });
      return (Array.isArray(ast) ? ast : [ast]) as unknown as ParsedStatement[];
    } catch {
      return [];
    }
  }

  private async executeSelect(connectionId: string, sql: string, statements: ParsedStatement[]): Promise<QueryResult> {
    const { sql: pagedSql, params } = buildPagedQuery(sql);

    const start = Date.now();
    const { rows, fields } = await this.pgConnectionService.runParameterized(connectionId, pagedSql, params);
    const executionTimeMs = Date.now() - start;

    const truncated = rows.length > QUERY_PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, QUERY_PAGE_SIZE) : rows;

    const editability = await this.resolveEditability(connectionId, statements);
    const columns = await this.mapColumns(connectionId, fields, editability.primaryKey);

    return {
      rows: pageRows,
      columns,
      totalRows: pageRows.length,
      truncated,
      executionTimeMs,
      ...editability,
    };
  }

  /**
   * `node-sql-parser` couldn't classify this statement, but it lexically looks like a single
   * `SELECT` (e.g. a CTE or Postgres-only syntax the parser doesn't support). Page it like a
   * real SELECT (principle §7); if the `buildPagedQuery` wrapper itself fails to parse on the
   * server, fall back to `executeOther` so Postgres reports the original error unbounded.
   */
  private async executeUnparsedSelect(connectionId: string, sql: string): Promise<QueryResult> {
    const { sql: pagedSql, params } = buildPagedQuery(sql);

    const start = Date.now();
    let rows: Record<string, unknown>[];
    let fields: FieldInfo[];
    try {
      ({ rows, fields } = await this.pgConnectionService.runParameterized(connectionId, pagedSql, params));
    } catch {
      return this.executeOther(connectionId, sql);
    }
    const executionTimeMs = Date.now() - start;

    const truncated = rows.length > QUERY_PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, QUERY_PAGE_SIZE) : rows;
    const columns = await this.mapColumns(connectionId, fields);

    return {
      rows: pageRows,
      columns,
      totalRows: pageRows.length,
      truncated,
      editable: false,
      executionTimeMs,
    };
  }

  private async executeOther(connectionId: string, sql: string): Promise<QueryResult> {
    const start = Date.now();
    const { rows, fields, rowCount, command } = await this.pgConnectionService.runParameterized(connectionId, sql);
    const executionTimeMs = Date.now() - start;

    const truncated = rows.length > QUERY_PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, QUERY_PAGE_SIZE) : rows;
    const columns = await this.mapColumns(connectionId, fields);

    return {
      rows: pageRows,
      columns,
      totalRows: pageRows.length,
      truncated,
      editable: false,
      executionTimeMs,
      command,
      rowCount: rowCount ?? undefined,
    };
  }

  private async resolveEditability(connectionId: string, statements: ParsedStatement[]): Promise<EditabilityResult> {
    const table = extractSingleTable(statements);
    if (!table) return { editable: false };

    const tableColumns = await this.metadataService.getTableColumns(connectionId, table.schema, table.table);
    const primaryKey = tableColumns.filter((column) => column.isPrimaryKey).map((column) => column.name);

    return analyzeEditability(statements, table, primaryKey);
  }

  /** Maps `pg` field metadata (OID-based types) to `ColumnMetadata` so results render in the shared grid. */
  private async mapColumns(connectionId: string, fields: FieldInfo[], primaryKey: string[] = []): Promise<ColumnMetadata[]> {
    if (fields.length === 0) return [];

    const oids = [...new Set(fields.map((field) => field.dataTypeID))];
    const { rows } = await this.pgConnectionService.runParameterized<{ oid: number; typname: string }>(
      connectionId,
      'SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])',
      [oids],
    );
    const typeNames = new Map(rows.map((row) => [Number(row.oid), row.typname]));
    const primaryKeySet = new Set(primaryKey);

    return fields.map((field) => ({
      name: field.name,
      dataType: typeNames.get(field.dataTypeID) ?? 'unknown',
      nullable: true,
      isPrimaryKey: primaryKeySet.has(field.name),
    }));
  }
}
