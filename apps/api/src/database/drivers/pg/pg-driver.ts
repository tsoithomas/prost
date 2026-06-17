import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Pool } from 'pg';
import type { AlterTableOperation, CreateIndexRequest, CreateTableRequest } from '@prost/shared-types';
import type { DbDriver, DriverErrorContext } from '../../db-driver.interface';
import type {
  ConnectionParams, DbCapabilities, DriverQueryFn, DriverResult, NativePool, SelectRowsOptions, SqlFragment, TableRef, TestConnectionResult, WhereDialect,
} from '../../types';
import * as sql from './pg-sql';

const CONNECT_TIMEOUT_MS = 5000;

function describeConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = Array.from(error.errors).find((e): e is Error => e instanceof Error && !!e.message);
    if (inner) return inner.message;
  }
  if (error instanceof Error && error.message) return error.message;
  const code = (error as { code?: string } | undefined)?.code;
  return code ? `Connection failed (${code})` : 'Connection failed';
}

@Injectable()
export class PgDriver implements DbDriver {
  readonly engine = 'postgres';
  readonly capabilities: DbCapabilities = { supportsReturning: true, supportsSchemas: true, parserDialect: 'postgresql' };

  private readonly logger = new Logger(PgDriver.name);
  private readonly statementTimeoutMs: number;
  private readonly poolSize: number;

  constructor(config: ConfigService) {
    this.statementTimeoutMs = Number(config.get('QUERY_TIMEOUT_MS') ?? 30_000);
    this.poolSize = Number(config.get('TARGET_POOL_SIZE') ?? 5);
  }

  async createPool(params: ConnectionParams): Promise<NativePool> {
    const pool = new Pool({
      host: params.host, port: params.port, database: params.database,
      user: params.username, password: params.password,
      ssl: params.sslEnabled ? { rejectUnauthorized: params.sslRejectUnauthorized } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: this.statementTimeoutMs, max: this.poolSize,
    });

    // An idle pooled client erroring out-of-band (server restart, network drop) emits an
    // 'error' on the Pool; without a listener Node treats it as unhandled and crashes the
    // process. Mirrors the handler the previous PgConnectionService attached.
    pool.on('error', (error) => {
      this.logger.error(`target pool error message=${error.message}`);
    });

    return pool;
  }

  async closePool(pool: NativePool): Promise<void> {
    await (pool as Pool).end();
  }

  async query(pool: NativePool, frag: SqlFragment): Promise<DriverResult> {
    const r = await (pool as Pool).query(frag.sql, frag.params);
    return { rows: r.rows, fields: r.fields, rowCount: r.rowCount, command: r.command };
  }

  async withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const client = await (pool as Pool).connect();
    const query: DriverQueryFn = async ({ sql: text, params = [] }) => {
      const r = await client.query(text, params);
      return { rows: r.rows, fields: r.fields, rowCount: r.rowCount, command: r.command };
    };
    try {
      return await fn(query);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async testConnection(params: ConnectionParams): Promise<TestConnectionResult> {
    const client = new Client({
      host: params.host, port: params.port, database: params.database,
      user: params.username, password: params.password,
      ssl: params.sslEnabled ? { rejectUnauthorized: params.sslRejectUnauthorized } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: this.statementTimeoutMs,
    });
    try {
      await client.connect();
      const r = await client.query<{ server_version: string }>('SHOW server_version');
      return { ok: true, message: 'Connection successful', serverVersion: r.rows[0]?.server_version };
    } catch (error) {
      return { ok: false, message: describeConnectionError(error) };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  quoteIdent = sql.pgQuoteIdent;
  placeholder = sql.pgPlaceholder;

  readonly whereDialect: WhereDialect = {
    placeholder: sql.pgPlaceholder,
    quoteIdent: sql.pgQuoteIdent,
    likeOperator: 'ILIKE',
    inList: (column, values, negated, firstIndex) => ({
      fragment: `${column} ${negated ? '<> ALL' : '= ANY'}(${sql.pgPlaceholder(firstIndex)})`,
      params: [values],
    }),
  };

  buildListTables = sql.pgBuildListTables;
  buildListAllColumns = sql.pgBuildListAllColumns;
  buildListColumns = (ref: TableRef) => sql.pgBuildListColumns(ref);
  buildListIndexes = (ref: TableRef) => sql.pgBuildListIndexes(ref);
  buildSelectRows = (ref: TableRef, opts: SelectRowsOptions) => sql.pgBuildSelectRows(ref, opts);
  buildFilteredRowCount = (ref: TableRef, w: string, p: unknown[]) => sql.pgBuildFilteredRowCount(ref, w, p);
  buildRowCountEstimate = (ref: TableRef) => sql.pgBuildRowCountEstimate(ref);
  buildInsertRow = (ref: TableRef, e: [string, unknown][]) => sql.pgBuildInsertRow(ref, e);
  buildUpdateRow = (ref: TableRef, c: string, v: unknown, pk: string[], pv: unknown[]) => sql.pgBuildUpdateRow(ref, c, v, pk, pv);
  buildDeleteRow = (ref: TableRef, pk: string[], pv: unknown[]) => sql.pgBuildDeleteRow(ref, pk, pv);
  buildCreateTable = (req: CreateTableRequest) => sql.pgBuildCreateTable(req);
  buildAlterTable = (ref: TableRef, op: AlterTableOperation) => sql.pgBuildAlterTable(ref, op);
  buildCreateIndex = (req: CreateIndexRequest, name: string, method: string) => sql.pgBuildCreateIndex(req, name, method);
  buildDropIndex = (ref: TableRef, indexName: string) => sql.pgBuildDropIndex(ref, indexName);
  buildResolveTypeNames = (oids: number[]) => sql.pgBuildResolveTypeNames(oids);

  mapError(error: unknown, ctx: DriverErrorContext): void {
    const code = (error as { code?: string } | undefined)?.code;
    if (ctx.operation === 'createTable' && code === '42P07') {
      throw new ConflictException(ctx.detail ?? 'Table already exists');
    }
    if (ctx.operation === 'alterTable') {
      if (code === '42703') throw new UnprocessableEntityException('Column does not exist');
      if (code === '42846') throw new UnprocessableEntityException('Cannot cast automatically; provide a USING expression');
      if (code === '23502') throw new UnprocessableEntityException('Column has existing null values; cannot set NOT NULL');
      if (code === '42701') throw new ConflictException('Column already exists');
    }
    if (ctx.operation === 'createIndex' && code === '42P07') {
      throw new ConflictException('An index with that name already exists');
    }
    if (ctx.operation === 'dropIndex' && code === '42704') {
      throw new UnprocessableEntityException('Index does not exist');
    }
  }
}
