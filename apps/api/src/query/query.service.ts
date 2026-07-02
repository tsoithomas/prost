import { BadRequestException, Injectable } from '@nestjs/common';
import { Parser } from 'node-sql-parser';
import type {
  ColumnMetadata,
  CommandStatementResult,
  ErrorStatementResult,
  ExecuteQueryResponse,
  FetchQueryPageResponse,
  PlanStatementResult,
  RowsStatementResult,
  StatementResult,
} from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import type { DbDriver } from '../database/db-driver.interface';
import type { DriverResult, SqlFragment } from '../database/types';
import { HistoryService } from '../history/history.service';
import { MetadataService } from '../metadata/metadata.service';
import { analyzeEditability, extractSingleTable, type EditabilityResult, type ParsedStatement } from './editability';
import { buildPagedQuery, looksLikeSingleSelect, QUERY_PAGE_SIZE } from './paging';
import { splitStatements } from './statement-splitter';

interface FieldInfo {
  name: string;
  dataTypeID: number;
  dataTypeName?: string;
}

type RunFn = (frag: SqlFragment) => Promise<DriverResult>;

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
    private readonly pool: PoolManager,
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

    const driver = await this.pool.driverFor(connectionId);
    const statements = transactional
      ? await this.executeTransactional(connectionId, driver, statementTexts, correlationId)
      : await this.executeAutocommit(connectionId, driver, statementTexts, correlationId);

    await this.historyService.record({ userId, connectionId, sql });

    return { statements, transactional, statementCount: statementTexts.length };
  }

  /**
   * Fetches the next page of a single `SELECT` (the editor's "Load more"). A lean read path —
   * no history record, no editability/column resolution (the client already has those from the
   * initial execute). `sql` must be exactly one statement that classifies as a SELECT; anything
   * else (multiple statements, INSERT/UPDATE/DDL, EXPLAIN) is rejected **before** any execution,
   * so "Load more" can never re-run a mutation.
   */
  async fetchPage(
    connectionId: string,
    sql: string,
    offset: number,
    limit = QUERY_PAGE_SIZE,
    sortBy?: string,
    sortDir: 'asc' | 'desc' = 'asc',
  ): Promise<FetchQueryPageResponse> {
    const statementTexts = splitStatements(sql);
    if (statementTexts.length !== 1) {
      throw new BadRequestException('Only a single SELECT statement can be paged');
    }

    const driver = await this.pool.driverFor(connectionId);
    const statementText = statementTexts[0]!;
    const ast = this.tryAstifyOne(driver, statementText);
    const isSelect = ast?.type === 'select';
    const isUnparsedSelect = ast === null && looksLikeSingleSelect(statementText);
    if (EXPLAIN_RE.test(statementText) || (!isSelect && !isUnparsedSelect)) {
      throw new BadRequestException('Only SELECT statements can be paged');
    }

    const orderBy = sortBy
      ? { column: sortBy, dir: sortDir, quoteIdent: (id: string) => driver.quoteIdent(id) }
      : undefined;
    const { sql: pagedSql, params } = buildPagedQuery(statementText, driver.placeholder, limit, offset, orderBy);
    const start = Date.now();
    const { rows } = await this.pool.run(connectionId, { sql: pagedSql, params });
    const executionTimeMs = Date.now() - start;

    const truncated = rows.length > limit;
    return { rows: truncated ? rows.slice(0, limit) : rows, truncated, executionTimeMs };
  }

  /**
   * Validates that `sql` is exactly one streamable SELECT and returns its statement text. Shared by
   * the cursor-session manager so a streamed read can never run a multi-statement script, a mutation,
   * or an EXPLAIN. Mirrors the guard in `fetchPage`.
   */
  async resolveSingleSelect(connectionId: string, sql: string): Promise<string> {
    const statementTexts = splitStatements(sql);
    if (statementTexts.length !== 1) {
      throw new BadRequestException('Only a single SELECT statement can be streamed');
    }
    const driver = await this.pool.driverFor(connectionId);
    const statementText = statementTexts[0]!;
    const ast = this.tryAstifyOne(driver, statementText);
    const isSelect = ast?.type === 'select';
    const isUnparsedSelect = ast === null && looksLikeSingleSelect(statementText);
    if (EXPLAIN_RE.test(statementText) || (!isSelect && !isUnparsedSelect)) {
      throw new BadRequestException('Only SELECT statements can be streamed');
    }
    return statementText;
  }

  /** Resolve the editability of a single SELECT statement (same analysis the initial execute uses). */
  async analyzeSelectEditability(connectionId: string, statementText: string): Promise<EditabilityResult> {
    const driver = await this.pool.driverFor(connectionId);
    const ast = this.tryAstifyOne(driver, statementText);
    if (ast?.type !== 'select') return { editable: false };
    return this.resolveEditability(connectionId, [ast]);
  }

  /** Resolve result-column metadata from a cursor's fields (reuses the driver's `describeResultColumns`). */
  async describeColumns(connectionId: string, fields: FieldInfo[], primaryKey: string[] = []): Promise<ColumnMetadata[]> {
    const driver = await this.pool.driverFor(connectionId);
    return this.mapColumns(connectionId, driver, fields, primaryKey);
  }

  /** Each statement runs (and commits) independently — a failure doesn't stop the rest (honest partial success, principle §8). */
  private async executeAutocommit(connectionId: string, driver: DbDriver, statementTexts: string[], correlationId: string): Promise<StatementResult[]> {
    const results: StatementResult[] = [];
    const isOnlyStatement = statementTexts.length === 1;

    for (const statementText of statementTexts) {
      try {
        results.push(
          await this.executeOneStatement(connectionId, driver, statementText, isOnlyStatement, (frag) => this.pool.run(connectionId, frag)),
        );
      } catch (error) {
        results.push(this.toErrorResult(statementText, error, correlationId));
      }
    }

    return results;
  }

  /** All statements share one client/session under BEGIN; the first failure rolls back the whole batch and stops. */
  private async executeTransactional(connectionId: string, driver: DbDriver, statementTexts: string[], correlationId: string): Promise<StatementResult[]> {
    return this.pool.withSession(connectionId, async (query) => {
      const results: StatementResult[] = [];
      await query({ sql: 'BEGIN', params: [] });

      for (const statementText of statementTexts) {
        try {
          results.push(await this.executeOneStatement(connectionId, driver, statementText, false, (frag) => query(frag)));
        } catch (error) {
          results.push(this.toErrorResult(statementText, error, correlationId));
          await query({ sql: 'ROLLBACK', params: [] });
          return results;
        }
      }

      await query({ sql: 'COMMIT', params: [] });
      return results;
    });
  }

  private async executeOneStatement(
    connectionId: string,
    driver: DbDriver,
    statementText: string,
    isOnlyStatement: boolean,
    run: RunFn,
  ): Promise<StatementResult> {
    const explainMatch = EXPLAIN_RE.exec(statementText);
    if (explainMatch) return this.executePlan(driver, statementText, explainMatch, run);

    const ast = this.tryAstifyOne(driver, statementText);
    const isSelect = ast?.type === 'select';
    const isUnparsedSelect = ast === null && looksLikeSingleSelect(statementText);

    if (isSelect || isUnparsedSelect) {
      return this.executeRows(connectionId, driver, statementText, ast, isOnlyStatement, run);
    }
    return this.executeCommand(connectionId, driver, statementText, run);
  }

  /** `node-sql-parser` throws on input it can't parse — return `null` and let the caller fall back. */
  private tryAstifyOne(driver: DbDriver, sql: string): ParsedStatement | null {
    try {
      const ast = this.parser.astify(sql, { database: driver.capabilities.parserDialect });
      const [first] = Array.isArray(ast) ? ast : [ast];
      return (first as unknown as ParsedStatement) ?? null;
    } catch {
      return null;
    }
  }

  private async executeRows(
    connectionId: string,
    driver: DbDriver,
    statementText: string,
    ast: ParsedStatement | null,
    isOnlyStatement: boolean,
    run: RunFn,
  ): Promise<StatementResult> {
    const { sql: pagedSql, params } = buildPagedQuery(statementText, driver.placeholder);
    const start = Date.now();

    let queryResult: DriverResult;
    if (ast === null) {
      // Unparsed-but-looks-like-a-SELECT: try paged, fall back to executeCommand if the wrapper itself fails.
      try {
        queryResult = await run({ sql: pagedSql, params });
      } catch {
        return this.executeCommand(connectionId, driver, statementText, run);
      }
    } else {
      // astify-confirmed SELECT — a failure here is a real error.
      queryResult = await run({ sql: pagedSql, params });
    }

    const executionTimeMs = Date.now() - start;
    const { rows, fields } = queryResult;
    const truncated = rows.length > QUERY_PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, QUERY_PAGE_SIZE) : rows;

    const editability =
      isOnlyStatement && ast?.type === 'select' ? await this.resolveEditability(connectionId, [ast]) : { editable: false as const };

    const columns = await this.mapColumns(connectionId, driver, fields, editability.primaryKey);

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

  private async executeCommand(
    connectionId: string,
    driver: DbDriver,
    statementText: string,
    run: RunFn,
  ): Promise<StatementResult> {
    const start = Date.now();
    const { rows, fields, rowCount, command } = await run({ sql: statementText, params: [] });

    // A statement that wasn't classified as SELECT/EXPLAIN but still returns columns is a result
    // set (e.g. DESCRIBE/SHOW on MySQL, PRAGMA on SQLite) — render it as a read-only grid rather
    // than an affected-rows summary. Engine-neutral: any driver that returns `fields` qualifies.
    if (fields.length > 0) {
      const columns = await this.mapColumns(connectionId, driver, fields);
      const result: RowsStatementResult = {
        kind: 'rows',
        sql: statementText,
        rows,
        columns,
        totalRows: rows.length,
        truncated: false,
        editable: false,
        executionTimeMs: Date.now() - start,
      };
      return result;
    }

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
  private async executePlan(driver: DbDriver, statementText: string, explainMatch: RegExpExecArray, run: RunFn): Promise<StatementResult> {
    const optionsList = explainMatch[2] ?? '';
    const analyze = /^\s*explain\s+analyze\b/i.test(statementText) || /\banalyze\b/i.test(optionsList);

    const start = Date.now();
    const { rows } = await run({ sql: statementText, params: [] });
    const planText = driver.formatExplain(rows as Record<string, unknown>[]);

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
    const defaultSchema = await this.pool.defaultNamespace(connectionId);
    const table = extractSingleTable(statements, defaultSchema);
    if (!table) return { editable: false };

    const tableColumns = await this.metadataService.getTableColumns(connectionId, table.schema, table.table);
    const primaryKey = tableColumns.filter((column) => column.isPrimaryKey).map((column) => column.name);

    return analyzeEditability(statements, table, primaryKey);
  }

  private mapColumns(connectionId: string, driver: DbDriver, fields: FieldInfo[], primaryKey: string[] = []): Promise<ColumnMetadata[]> {
    if (fields.length === 0) return Promise.resolve([]);
    return driver.describeResultColumns((frag) => this.pool.run(connectionId, frag), fields, primaryKey);
  }
}
