import { BadRequestException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Parser } from 'node-sql-parser';
import type {
  ColumnMetadata,
  CommandStatementResult,
  ErrorStatementResult,
  AuditAction,
  ExecuteQueryResponse,
  FetchQueryPageResponse,
  PlanStatementResult,
  QueryPlanResult,
  RowsStatementResult,
  StatementResult,
} from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import type { DbDriver } from '../database/db-driver.interface';
import type { DriverResult, SqlFragment } from '../database/types';
import { AuditService } from '../audit/audit.service';
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

/** node-sql-parser statement `type`s that mutate data — used to unmask writes hidden inside a SELECT. */
const WRITE_STATEMENT_TYPES = new Set(['insert', 'update', 'delete', 'replace']);

/** Row cap for a query the agent runs (Phase 31) — bounds both the grid page and the model's sample source. */
const AGENT_QUERY_ROW_LIMIT = 100;

/**
 * True if the AST subtree contains a data-modifying statement. A top-level `SELECT` can still write
 * via a data-modifying CTE (`WITH x AS (INSERT ... RETURNING ...) SELECT ...`), which parses as
 * `type: 'select'`; the read-only guard scans for these so such a statement is never misread as a
 * pure read. Read-only nodes (nested `select` subqueries, column refs, …) never match.
 */
function astContainsWriteStatement(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const type = (node as { type?: unknown }).type;
  if (typeof type === 'string' && WRITE_STATEMENT_TYPES.has(type.toLowerCase())) return true;
  const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  return children.some(astContainsWriteStatement);
}

const WRITE_ACTION_BY_KEYWORD: Record<string, AuditAction> = {
  insert: 'insert',
  update: 'update',
  delete: 'delete',
  replace: 'insert',
  truncate: 'truncate',
};

/** The audit action for a mutating statement — DML by type/keyword, everything else (DDL) → `'ddl'`. */
function auditActionForStatement(ast: ParsedStatement | null, text: string): AuditAction {
  const type = typeof ast?.type === 'string' ? ast.type.toLowerCase() : undefined;
  if (type && WRITE_ACTION_BY_KEYWORD[type]) return WRITE_ACTION_BY_KEYWORD[type]!;
  const keyword = text.trim().split(/\s+/)[0]?.toLowerCase();
  return (keyword && WRITE_ACTION_BY_KEYWORD[keyword]) || 'ddl';
}

/** Best-effort `schema`/`table` from an INSERT/UPDATE/DELETE AST; empty when it can't be resolved. */
function auditTargetFromAst(ast: ParsedStatement | null): { schema?: string; table?: string } {
  const raw = (ast as { table?: unknown; from?: unknown } | null)?.table ?? (ast as { from?: unknown } | null)?.from;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first && typeof first === 'object' && typeof (first as { table?: unknown }).table === 'string') {
    const ref = first as { db?: unknown; table: string };
    return { ...(typeof ref.db === 'string' && ref.db ? { schema: ref.db } : {}), table: ref.table };
  }
  return {};
}

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
    private readonly audit: AuditService,
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

    // Phase 25 guardrail: on a read-only connection, reject the whole script if any statement is a
    // write — before anything executes (no partial run). A statement that can't be *proven* read-only
    // (unparsable non-SELECT, EXPLAIN ANALYZE of a write, DML/DDL) is treated as a write (fail safe).
    if (await this.pool.isReadOnly(connectionId)) {
      const blocked = statementTexts.filter((text) => this.classifyStatement(driver, text) === 'write');
      if (blocked.length > 0) {
        // Phase 28: a blocked write is exactly what the audit trail should record.
        for (const text of blocked) {
          this.auditStatement(driver, userId, connectionId, correlationId, text, 'failure', 'read-only', 0);
        }
        throw new ForbiddenException('This connection is read-only');
      }
    }

    const statements = transactional
      ? await this.executeTransactional(connectionId, driver, statementTexts, correlationId)
      : await this.executeAutocommit(connectionId, driver, statementTexts, correlationId);

    await this.historyService.record({ userId, connectionId, sql });
    this.auditMutations(driver, userId, connectionId, correlationId, statementTexts, statements, transactional);

    return { statements, transactional, statementCount: statementTexts.length };
  }

  /** Audits each mutating statement (Phase 28). A rolled-back transaction marks its writes as failure. */
  private auditMutations(
    driver: DbDriver,
    userId: string,
    connectionId: string,
    correlationId: string,
    statementTexts: string[],
    statements: StatementResult[],
    transactional: boolean,
  ): void {
    const rolledBack = transactional && statements.some((s) => s.kind === 'error');
    for (let i = 0; i < statementTexts.length; i++) {
      const text = statementTexts[i]!;
      if (this.classifyStatement(driver, text) !== 'write') continue;
      const action = auditActionForStatement(this.tryAstifyOne(driver, text), text);
      const result = statements[i];
      if (!result && !rolledBack) continue; // never attempted
      const failed = rolledBack || !result || result.kind === 'error';
      const errorClass =
        result?.kind === 'error' ? (result.code ?? 'Error') : rolledBack ? 'rolled_back' : null;
      this.auditStatement(
        driver,
        userId,
        connectionId,
        correlationId,
        text,
        failed ? 'failure' : 'success',
        errorClass,
        result?.executionTimeMs ?? 0,
        action,
      );
    }
  }

  private auditStatement(
    driver: DbDriver,
    userId: string,
    connectionId: string,
    correlationId: string,
    text: string,
    outcome: 'success' | 'failure',
    errorClass: string | null,
    durationMs: number,
    action: AuditAction = auditActionForStatement(this.tryAstifyOne(driver, text), text),
  ): void {
    const target = auditTargetFromAst(this.tryAstifyOne(driver, text));
    void this.audit.record({
      userId,
      connectionId,
      action,
      sql: text,
      targetSchema: target.schema ?? null,
      targetTable: target.table ?? null,
      outcome,
      errorClass,
      durationMs,
      correlationId: correlationId || null,
    });
  }

  /**
   * Produces a structured query plan for a single statement (Phase 26). Plain `EXPLAIN` estimates
   * cost only and is safe on any connection; `analyze` actually runs the statement, so it is offered
   * only where the engine supports it and is rejected on read-only connections (Phase 25). Never
   * touches the editability analyzer or the normal execute path — it's a separate lens.
   */
  async explain(connectionId: string, sql: string, analyze: boolean): Promise<QueryPlanResult> {
    const statements = splitStatements(sql);
    if (statements.length !== 1) {
      throw new BadRequestException('Explain expects a single statement');
    }
    const statement = statements[0]!;

    const driver = await this.pool.driverFor(connectionId);
    if (!driver.descriptor.supportsQueryPlan) {
      throw new BadRequestException('This engine does not support structured query plans');
    }
    if (analyze) {
      if (!driver.descriptor.supportsExplainAnalyze) {
        throw new BadRequestException('Explain Analyze is not supported for this engine');
      }
      if (await this.pool.isReadOnly(connectionId)) {
        throw new ForbiddenException('This connection is read-only');
      }
    }

    const start = Date.now();
    const { rows } = await this.pool.run(connectionId, driver.buildExplain(statement, analyze));
    return {
      root: driver.parseExplain(rows, analyze),
      analyze,
      format: driver.engine === 'sqlite' ? 'steps' : 'json',
      planText: driver.formatExplain(rows),
      executionTimeMs: Date.now() - start,
    };
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

  /**
   * Runs a single, provably read-only `SELECT` for the agentic assistant (Phase 31) and returns a
   * bounded grid result. Read-only is proven *before* execution — exactly one statement, parseable,
   * a `SELECT` with no data-modifying CTE, not EXPLAIN — and enforced *during* execution by an engine
   * read-only transaction (belt and suspenders). Unlike user-authored SQL, model-authored SQL that
   * the parser can't parse is **refused** rather than trusted via the lexical fallback.
   */
  async runReadOnlyQuery(connectionId: string, sql: string): Promise<RowsStatementResult> {
    const statements = splitStatements(sql);
    if (statements.length !== 1) {
      throw new UnprocessableEntityException('The assistant may only run a single read-only SELECT statement');
    }
    const statementText = statements[0]!;
    const driver = await this.pool.driverFor(connectionId);

    if (EXPLAIN_RE.test(statementText)) {
      throw new UnprocessableEntityException('EXPLAIN cannot be run by the assistant');
    }
    const ast = this.tryAstifyOne(driver, statementText);
    if (ast === null) {
      throw new UnprocessableEntityException('The statement could not be parsed as a read-only query');
    }
    if (ast.type !== 'select' || astContainsWriteStatement(ast)) {
      throw new UnprocessableEntityException('Only read-only SELECT statements can be run by the assistant');
    }

    const { sql: pagedSql, params } = buildPagedQuery(statementText, driver.placeholder, AGENT_QUERY_ROW_LIMIT);
    const start = Date.now();
    const queryResult = await this.pool.withReadOnlyTransaction(connectionId, (q) => q({ sql: pagedSql, params }));
    const executionTimeMs = Date.now() - start;

    const { rows, fields } = queryResult;
    const truncated = rows.length > AGENT_QUERY_ROW_LIMIT;
    const pageRows = truncated ? rows.slice(0, AGENT_QUERY_ROW_LIMIT) : rows;

    const editability = await this.resolveEditability(connectionId, [ast]);
    const columns = await this.mapColumns(connectionId, driver, fields, editability.primaryKey);

    return {
      kind: 'rows',
      sql: statementText,
      rows: pageRows,
      columns,
      totalRows: pageRows.length,
      truncated,
      executionTimeMs,
      ...editability,
    };
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

  /**
   * Classifies a single statement as `'read'` or `'write'` for the read-only guardrail (Phase 25).
   * Read iff it is provably non-mutating: a plain `EXPLAIN` (no `ANALYZE`), a parsed `SELECT`, or an
   * unparsable statement that lexically looks like a single `SELECT`. Everything else — DML/DDL,
   * `EXPLAIN ANALYZE <write>`, and anything unprovable — is a write. Mirrors the executor's own
   * SELECT/EXPLAIN detection so classification and execution never disagree.
   */
  private classifyStatement(driver: DbDriver, statementText: string): 'read' | 'write' {
    const explainMatch = EXPLAIN_RE.exec(statementText);
    if (explainMatch) {
      const analyze =
        /^\s*explain\s+analyze\b/i.test(statementText) || /\banalyze\b/i.test(explainMatch[2] ?? '');
      return analyze ? 'write' : 'read';
    }
    const ast = this.tryAstifyOne(driver, statementText);
    if (ast === null) return looksLikeSingleSelect(statementText) ? 'read' : 'write';
    // A parsed SELECT is a read unless it hides a write in a data-modifying CTE.
    if (ast.type === 'select') return astContainsWriteStatement(ast) ? 'write' : 'read';
    return 'write';
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
