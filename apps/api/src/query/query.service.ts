import { Injectable } from '@nestjs/common';
import { Parser } from 'node-sql-parser';
import type {
  ColumnMetadata,
  CommandStatementResult,
  ErrorStatementResult,
  ExecuteQueryResponse,
  PlanStatementResult,
  RowsStatementResult,
  StatementResult,
} from '@prost/shared-types';
import { HistoryService } from '../history/history.service';
import { MetadataService } from '../metadata/metadata.service';
import { PgConnectionService, type ClientQueryResult, type ParameterizedResult } from '../target-db/pg-connection.service';
import { analyzeEditability, extractSingleTable, type EditabilityResult, type ParsedStatement } from './editability';
import { buildPagedQuery, looksLikeSingleSelect, QUERY_PAGE_SIZE } from './paging';
import { splitStatements } from './statement-splitter';

interface FieldInfo {
  name: string;
  dataTypeID: number;
}

type RunFn = (sql: string, params?: unknown[]) => Promise<ClientQueryResult | ParameterizedResult>;

/**
 * `node-sql-parser@5.4.0` throws on ANY `EXPLAIN ...` input for the postgresql dialect, so
 * EXPLAIN must be detected lexically before `astify` is attempted. Captures the `(...)`
 * options list (if present) so `executePlan` can check for `ANALYZE` among them.
 */
const EXPLAIN_RE = /^\s*explain\b\s*(\(([^)]*)\))?/i;

/**
 * Executes a SQL script against a target connection (architecture principle §10 —
 * `QueryModule` is its own bounded module). The script is split into top-level statements
 * (`splitStatements`) and run either autocommit (each statement independently committed) or
 * inside a single transaction (`transactional: true`, rolled back on the first error).
 * `SELECT`s are paged via `buildPagedQuery` and run through the editability analyzer when they
 * are the script's only statement; `EXPLAIN`/`EXPLAIN ANALYZE` render as a plan; anything else
 * returns an affected-row summary rather than a grid (spec §6.7, Decision 4).
 */
@Injectable()
export class QueryService {
  private readonly parser = new Parser();

  constructor(
    private readonly pgConnectionService: PgConnectionService,
    private readonly metadataService: MetadataService,
    private readonly historyService: HistoryService,
  ) {}

  async execute(
    connectionId: string,
    sql: string,
    userId: string,
    correlationId = '',
    transactional = false,
  ): Promise<ExecuteQueryResponse> {
    const statementTexts = splitStatements(sql);
    if (statementTexts.length === 0) {
      return { statements: [], transactional, statementCount: 0 };
    }

    const statements = transactional
      ? await this.executeTransactional(connectionId, statementTexts, correlationId)
      : await this.executeAutocommit(connectionId, statementTexts, correlationId);

    await this.historyService.record({ userId, connectionId, sql });

    return { statements, transactional, statementCount: statementTexts.length };
  }

  /** Each statement runs (and commits) independently — a failure doesn't stop the rest (honest partial success, principle §8). */
  private async executeAutocommit(connectionId: string, statementTexts: string[], correlationId: string): Promise<StatementResult[]> {
    const results: StatementResult[] = [];
    const isOnlyStatement = statementTexts.length === 1;

    for (const statementText of statementTexts) {
      try {
        results.push(
          await this.executeOneStatement(connectionId, statementText, isOnlyStatement, (runSql, params) =>
            this.pgConnectionService.runParameterized(connectionId, runSql, params),
          ),
        );
      } catch (error) {
        results.push(this.toErrorResult(statementText, error, correlationId));
      }
    }

    return results;
  }

  /** All statements share one client/session under BEGIN; the first failure rolls back the whole batch and stops. */
  private async executeTransactional(connectionId: string, statementTexts: string[], correlationId: string): Promise<StatementResult[]> {
    return this.pgConnectionService.withTransactionClient(connectionId, async (query) => {
      const results: StatementResult[] = [];
      await query({ sql: 'BEGIN' });

      for (const statementText of statementTexts) {
        try {
          results.push(await this.executeOneStatement(connectionId, statementText, false, (runSql, params) => query({ sql: runSql, params })));
        } catch (error) {
          results.push(this.toErrorResult(statementText, error, correlationId));
          await query({ sql: 'ROLLBACK' });
          return results;
        }
      }

      await query({ sql: 'COMMIT' });
      return results;
    });
  }

  private async executeOneStatement(
    connectionId: string,
    statementText: string,
    isOnlyStatement: boolean,
    run: RunFn,
  ): Promise<StatementResult> {
    const explainMatch = EXPLAIN_RE.exec(statementText);
    if (explainMatch) return this.executePlan(statementText, explainMatch, run);

    const ast = this.tryAstifyOne(statementText);
    const isSelect = ast?.type === 'select';
    const isUnparsedSelect = ast === null && looksLikeSingleSelect(statementText);

    if (isSelect || isUnparsedSelect) {
      return this.executeRows(connectionId, statementText, ast, isOnlyStatement, run);
    }
    return this.executeCommand(statementText, run);
  }

  /** `node-sql-parser` throws on input it can't parse — return `null` and let the caller fall back. */
  private tryAstifyOne(sql: string): ParsedStatement | null {
    try {
      const ast = this.parser.astify(sql, { database: 'postgresql' });
      const [first] = Array.isArray(ast) ? ast : [ast];
      return (first as unknown as ParsedStatement) ?? null;
    } catch {
      return null;
    }
  }

  private async executeRows(
    connectionId: string,
    statementText: string,
    ast: ParsedStatement | null,
    isOnlyStatement: boolean,
    run: RunFn,
  ): Promise<StatementResult> {
    const { sql: pagedSql, params } = buildPagedQuery(statementText);
    const start = Date.now();

    let queryResult: ClientQueryResult | ParameterizedResult;
    if (ast === null) {
      // Unparsed-but-looks-like-a-SELECT: try paged, fall back to executeCommand if the wrapper itself fails.
      try {
        queryResult = await run(pagedSql, params);
      } catch {
        return this.executeCommand(statementText, run);
      }
    } else {
      // astify-confirmed SELECT — a failure here is a real error.
      queryResult = await run(pagedSql, params);
    }

    const executionTimeMs = Date.now() - start;
    const { rows, fields } = queryResult;
    const truncated = rows.length > QUERY_PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, QUERY_PAGE_SIZE) : rows;

    const editability =
      isOnlyStatement && ast?.type === 'select' ? await this.resolveEditability(connectionId, [ast]) : { editable: false as const };

    const columns = await this.mapColumns(connectionId, fields, editability.primaryKey);

    const result: RowsStatementResult = {
      kind: 'rows',
      sql: statementText,
      rows: pageRows,
      columns,
      totalRows: pageRows.length,
      truncated,
      executionTimeMs,
      ...editability,
    };
    return result;
  }

  private async executeCommand(statementText: string, run: RunFn): Promise<StatementResult> {
    const start = Date.now();
    const { rowCount, command } = await run(statementText);
    const result: CommandStatementResult = {
      kind: 'command',
      sql: statementText,
      command,
      rowCount: rowCount ?? 0,
      executionTimeMs: Date.now() - start,
    };
    return result;
  }

  /** Covers both `EXPLAIN ANALYZE ...` and `EXPLAIN (ANALYZE, ...) ...`. Runs the statement exactly as written — no FORMAT JSON rewrite. */
  private async executePlan(statementText: string, explainMatch: RegExpExecArray, run: RunFn): Promise<StatementResult> {
    const optionsList = explainMatch[2] ?? '';
    const analyze = /^\s*explain\s+analyze\b/i.test(statementText) || /\banalyze\b/i.test(optionsList);

    const start = Date.now();
    const { rows } = await run(statementText);
    const planText = rows.map((row) => String((row as Record<string, unknown>)['QUERY PLAN'] ?? '')).join('\n');

    const result: PlanStatementResult = {
      kind: 'plan',
      sql: statementText,
      planText,
      analyze,
      executionTimeMs: Date.now() - start,
    };
    return result;
  }

  private toErrorResult(statementText: string, error: unknown, correlationId: string): ErrorStatementResult {
    const code = (error as { code?: string } | undefined)?.code;
    const message = error instanceof Error ? error.message : 'The statement could not be executed.';
    return {
      kind: 'error',
      sql: statementText,
      message,
      code: typeof code === 'string' ? code : undefined,
      correlationId,
      executionTimeMs: 0,
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
