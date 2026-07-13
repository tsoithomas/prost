import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AlterTableOperation,
  ColumnMetadata,
  CreateIndexRequest,
  CreateTableRequest,
  DbEngineDescriptor,
  SchemaObjectKind,
} from '@prost/shared-types';
import {
  createConnection,
  createPool as createMysqlPool,
  type Connection,
  type FieldPacket,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import type { Readable } from 'node:stream';
import type { DbDriver, DriverErrorContext } from '../../db-driver.interface';
import type {
  ConnectionParams,
  DbCapabilities,
  DriverCursor,
  DriverQueryFn,
  DriverResult,
  NativePool,
  RowUpdateGuard,
  SelectRowsOptions,
  SqlFragment,
  TableRef,
  TestConnectionResult,
  WhereDialect,
} from '../../types';
import * as sql from './mysql-sql';

/**
 * The streaming surface of mysql2's core (callback) connection, reached through the promise
 * `PoolConnection.connection`. `query(...).stream()` reads rows off the wire incrementally rather
 * than buffering the whole result — the basis for the forward-only cursor.
 */
interface CoreStreamingConnection {
  query(options: { sql: string; values: unknown[] }): {
    on(event: 'fields', listener: (fields: FieldPacket[]) => void): unknown;
    stream(options?: { highWaterMark?: number }): Readable;
  };
}

const CONNECT_TIMEOUT_MS = 5000;

function leadingKeyword(text: string): string {
  return /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase() ?? '';
}

function describeConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = Array.from(error.errors).find(
      (candidate): candidate is Error => candidate instanceof Error && !!candidate.message,
    );
    if (inner) return inner.message;
  }
  if (error instanceof Error && error.message) return error.message;
  const code = (error as { code?: string } | undefined)?.code;
  return code ? `Connection failed (${code})` : 'Connection failed';
}

function versionFromRows(rows: unknown): string {
  if (!Array.isArray(rows)) return '';
  const version = (rows[0] as { version?: unknown } | undefined)?.version;
  return typeof version === 'string' ? version : String(version ?? '');
}

function normalizeResult(
  statement: string,
  rows: RowDataPacket[] | RowDataPacket[][] | ResultSetHeader,
  fields: FieldPacket[] | undefined,
): DriverResult {
  const command = leadingKeyword(statement);
  if (Array.isArray(rows)) {
    return {
      rows: rows as DriverResult['rows'],
      fields: (fields ?? []).map((field) => ({
        name: field.name,
        dataTypeID: (field.columnType ?? field.type) as number,
        dataTypeName: undefined,
      })),
      rowCount: rows.length,
      command,
      lastInsertId: undefined,
    };
  }

  return {
    rows: [],
    fields: [],
    rowCount: rows.affectedRows,
    command,
    lastInsertId: rows.insertId,
  };
}

async function runQuery(
  target: Pool | PoolConnection,
  frag: SqlFragment,
  timeout: number,
): Promise<DriverResult> {
  const [rows, fields] = await target.query({
    sql: frag.sql,
    values: frag.params,
    timeout,
  });
  return normalizeResult(
    frag.sql,
    rows as RowDataPacket[] | RowDataPacket[][] | ResultSetHeader,
    fields,
  );
}

export function assertSupportedVersion(versionString: string): void {
  if (/mariadb/i.test(versionString)) {
    throw new Error(
      `MariaDB is not supported; Prost requires MySQL 8.0 or newer (server reported "${versionString}")`,
    );
  }
  const major = Number.parseInt(/^\s*(\d+)/.exec(versionString)?.[1] ?? '', 10);
  if (!Number.isFinite(major) || major < 8) {
    throw new Error(`MySQL 8.0 or newer is required (server reported "${versionString}")`);
  }
}

@Injectable()
export class MysqlDriver implements DbDriver {
  readonly engine = 'mysql';
  readonly capabilities: DbCapabilities = {
    supportsReturning: false,
    supportsSchemas: false,
    parserDialect: 'mysql',
    // MySQL exposes no per-row version token, so writes guard on the edited columns' pre-image.
    concurrency: 'preimage',
    supportsCursors: true,
  };
  readonly descriptor: DbEngineDescriptor = {
    engine: 'mysql',
    label: 'MySQL',
    connectionMode: 'network',
    defaultPort: 3306,
    uriSchemes: ['mysql'],
    parserDialect: 'mysql',
    formatterDialect: 'mysql',
    namespaceLabel: 'Database',
    supportsSsl: true,
    sslEnabledByDefault: false,
    supportsCursors: true,
    ddl: {
      columnTypes: [
        'int',
        'bigint',
        'smallint',
        'tinyint',
        'decimal',
        'decimal(10,2)',
        'float',
        'double',
        'boolean',
        'varchar(255)',
        'varchar(64)',
        'char(1)',
        'text',
        'mediumtext',
        'longtext',
        'date',
        'time',
        'datetime',
        'timestamp',
        'json',
        'blob',
        'binary',
      ],
      defaultExamples: ['NULL', '0', 'CURRENT_TIMESTAMP', 'true', 'false'],
      indexMethods: ['btree'],
      supportsAutoIncrement: true,
      supportsUsingExpression: false,
    },
    objects: {
      views: true, materializedViews: false, sequences: false,
      functions: true, procedures: true, triggers: true, enums: false,
    },
  };

  private readonly logger = new Logger(MysqlDriver.name);
  private readonly queryTimeoutMs: number;
  private readonly poolSize: number;

  constructor(config: ConfigService) {
    this.queryTimeoutMs = Number(config.get('QUERY_TIMEOUT_MS') ?? 30_000);
    this.poolSize = Number(config.get('TARGET_POOL_SIZE') ?? 5);
  }

  async createPool(params: ConnectionParams): Promise<NativePool> {
    const pool = createMysqlPool({
      host: params.host,
      port: params.port,
      user: params.username,
      password: params.password,
      database: params.database,
      ssl: params.sslEnabled ? { rejectUnauthorized: params.sslRejectUnauthorized } : undefined,
      connectionLimit: this.poolSize,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });

    (
      pool as unknown as {
        on(event: 'error', listener: (error: Error) => void): void;
      }
    ).on('error', (error) => {
      this.logger.error(`target pool error message=${error.message}`);
    });

    try {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query({
          sql: 'SELECT VERSION() AS version',
          values: [],
          timeout: this.queryTimeoutMs,
        });
        assertSupportedVersion(versionFromRows(rows));
      } finally {
        connection.release();
      }
      return pool;
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw error;
    }
  }

  async closePool(pool: NativePool): Promise<void> {
    await (pool as Pool).end();
  }

  async query(pool: NativePool, frag: SqlFragment): Promise<DriverResult> {
    return runQuery(pool as Pool, frag, this.queryTimeoutMs);
  }

  async withSession<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const connection = await (pool as Pool).getConnection();
    const query: DriverQueryFn = (frag) => runQuery(connection, frag, this.queryTimeoutMs);
    try {
      return await fn(query);
    } finally {
      connection.release();
    }
  }

  async withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const connection = await (pool as Pool).getConnection();
    const query: DriverQueryFn = (frag) => runQuery(connection, frag, this.queryTimeoutMs);
    try {
      await connection.beginTransaction();
      const result = await fn(query);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async openCursor(pool: NativePool, frag: SqlFragment): Promise<DriverCursor> {
    // Pin a pooled connection and stream rows off the wire (no full-result buffering). The stream's
    // async iterator gives natural backpressure: each fetch pulls N rows then the protocol pauses.
    const connection = await (pool as Pool).getConnection();
    const core = (connection as unknown as { connection: CoreStreamingConnection }).connection;
    let fields: { name: string; dataTypeID: number; dataTypeName?: string }[] = [];

    const queryStream = core.query({ sql: frag.sql, values: frag.params });
    queryStream.on('fields', (packets) => {
      if (fields.length === 0 && Array.isArray(packets)) {
        fields = packets.map((field) => ({
          name: field.name,
          dataTypeID: (field.columnType ?? field.type) as number,
          dataTypeName: undefined,
        }));
      }
    });
    const stream = queryStream.stream({ highWaterMark: 256 });
    const iterator = stream[Symbol.asyncIterator]();
    let ended = false;
    let closed = false;

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      if (ended) {
        // Result fully drained — the connection is clean and reusable.
        connection.release();
      } else {
        // Abandoned mid-result: drop the connection rather than return a busy one to the pool.
        stream.destroy();
        connection.destroy();
      }
    };

    return {
      async fetch(n) {
        const rows: Record<string, unknown>[] = [];
        let complete = false;
        for (let i = 0; i < n; i += 1) {
          const next = await iterator.next();
          if (next.done) {
            ended = true;
            complete = true;
            break;
          }
          rows.push(next.value as Record<string, unknown>);
        }
        // Defensive: if the 'fields' event never landed, fall back to name-only columns.
        const sample = rows[0];
        if (fields.length === 0 && sample) {
          fields = Object.keys(sample).map((name) => ({ name, dataTypeID: 0, dataTypeName: undefined }));
        }
        if (complete) await close();
        return { rows, complete };
      },
      columns: () => fields,
      close,
    };
  }

  async testConnection(params: ConnectionParams): Promise<TestConnectionResult> {
    let connection: Connection | undefined;
    try {
      connection = await createConnection({
        host: params.host,
        port: params.port,
        user: params.username,
        password: params.password,
        database: params.database,
        ssl: params.sslEnabled ? { rejectUnauthorized: params.sslRejectUnauthorized } : undefined,
        connectTimeout: CONNECT_TIMEOUT_MS,
      });
      const [rows] = await connection.query({
        sql: 'SELECT VERSION() AS version',
        values: [],
        timeout: this.queryTimeoutMs,
      });
      const serverVersion = versionFromRows(rows);
      assertSupportedVersion(serverVersion);
      return { ok: true, message: 'Connection successful', serverVersion };
    } catch (error) {
      return { ok: false, message: describeConnectionError(error) };
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }

  quoteIdent = sql.mysqlQuoteIdent;
  placeholder = sql.mysqlPlaceholder;

  readonly whereDialect: WhereDialect = {
    placeholder: sql.mysqlPlaceholder,
    quoteIdent: sql.mysqlQuoteIdent,
    likeOperator: 'LIKE',
    inList: sql.mysqlInList,
  };

  buildListTables = sql.mysqlBuildListTables;
  buildListAllColumns = sql.mysqlBuildListAllColumns;
  buildListColumns = (ref: TableRef) => sql.mysqlBuildListColumns(ref);
  buildListIndexes = (ref: TableRef) => sql.mysqlBuildListIndexes(ref);
  buildListForeignKeys = (ref: TableRef) => sql.mysqlBuildListForeignKeys(ref);
  buildListReferencingForeignKeys = (ref: TableRef) => sql.mysqlBuildListReferencingForeignKeys(ref);
  buildListAllSchemaObjects = () => sql.mysqlBuildListAllSchemaObjects();
  buildObjectDefinition = (kind: SchemaObjectKind, ref: TableRef) => sql.mysqlBuildObjectDefinition(kind, ref);
  buildSchemaTableStats = (namespace: string) => sql.mysqlBuildSchemaTableStats(namespace);
  buildSelectRows = (ref: TableRef, opts: SelectRowsOptions) => sql.mysqlBuildSelectRows(ref, opts);
  buildFilteredRowCount = (ref: TableRef, whereClause: string, params: unknown[]) =>
    sql.mysqlBuildFilteredRowCount(ref, whereClause, params);
  buildRowCountEstimate = (ref: TableRef) => sql.mysqlBuildRowCountEstimate(ref);
  buildInsertRow = (ref: TableRef, entries: [string, unknown][]) => sql.mysqlBuildInsertRow(ref, entries);
  buildUpdateRow = (ref: TableRef, column: string, value: unknown, pk: string[], pv: unknown[]) =>
    sql.mysqlBuildUpdateRow(ref, column, value, pk, pv);
  buildUpdateRowGuarded = (ref: TableRef, edits: [string, unknown][], pk: string[], pv: unknown[], guard: RowUpdateGuard) =>
    sql.mysqlBuildUpdateRowGuarded(ref, edits, pk, pv, guard);

  async insertRow(
    q: DriverQueryFn,
    ref: TableRef,
    entries: [string, unknown][],
    columns: ColumnMetadata[],
  ): Promise<Record<string, unknown>> {
    const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
    const autoIncrementPrimaryKey = columns.find(
      (column) => column.isPrimaryKey && column.autoIncrement,
    )?.name;
    const supplied = new Map(entries);
    const missing = primaryKey.filter((column) => !supplied.has(column));
    const hasCompletePrimaryKey = primaryKey.length > 0 && missing.length === 0;
    const hasOneMissingAutoIncrementKey =
      missing.length === 1 && missing[0] === autoIncrementPrimaryKey;

    if (!hasCompletePrimaryKey && !hasOneMissingAutoIncrementKey) {
      throw new UnprocessableEntityException(
        'MySQL inserts require a complete primary key or exactly one missing AUTO_INCREMENT primary-key component',
      );
    }

    const inserted = await q(sql.mysqlBuildInsertRow(ref, entries));
    const primaryKeyValues = primaryKey.map((column) =>
      column === missing[0] ? inserted.lastInsertId : supplied.get(column),
    );
    const selected = await q(sql.mysqlBuildSelectByPk(ref, primaryKey, primaryKeyValues));
    return selected.rows[0] as Record<string, unknown>;
  }

  async updateRow(
    q: DriverQueryFn,
    ref: TableRef,
    column: string,
    value: unknown,
    primaryKey: string[],
    primaryKeyValues: unknown[],
  ): Promise<Record<string, unknown>> {
    await q(sql.mysqlBuildUpdateRow(ref, column, value, primaryKey, primaryKeyValues));
    const resultingPrimaryKeyValues = primaryKey.map((primaryKeyColumn, index) =>
      primaryKeyColumn === column ? value : primaryKeyValues[index],
    );
    const selected = await q(sql.mysqlBuildSelectByPk(ref, primaryKey, resultingPrimaryKeyValues));
    if (!selected.rows[0]) {
      throw new NotFoundException(
        `Row in "${ref.namespace ?? ''}.${ref.name}" no longer exists — it may have been changed or deleted`,
      );
    }
    return selected.rows[0] as Record<string, unknown>;
  }

  buildDeleteRow = (ref: TableRef, primaryKey: string[], primaryKeyValues: unknown[]) =>
    sql.mysqlBuildDeleteRow(ref, primaryKey, primaryKeyValues);
  normalizeCreateTable = (request: CreateTableRequest) => sql.mysqlNormalizeCreateTable(request);
  normalizeAlterTable = (
    ref: TableRef,
    operation: AlterTableOperation,
    columns: ColumnMetadata[],
  ) => sql.mysqlNormalizeAlterTable(ref, operation, columns);
  normalizeCreateIndex = (request: CreateIndexRequest) => sql.mysqlNormalizeCreateIndex(request);
  buildCreateTable = (request: CreateTableRequest) => sql.mysqlBuildCreateTable(request);
  buildAlterTable = (ref: TableRef, operation: AlterTableOperation) =>
    sql.mysqlBuildAlterTable(ref, operation);
  buildCreateIndex = (request: CreateIndexRequest, name: string, method: string) =>
    sql.mysqlBuildCreateIndex(request, name, method);
  buildDropIndex = (ref: TableRef, indexName: string) => sql.mysqlBuildDropIndex(ref, indexName);
  buildDropTable = (ref: TableRef) => sql.mysqlBuildDropTable(ref);
  buildTruncateTable = (ref: TableRef) => sql.mysqlBuildTruncateTable(ref);

  async describeResultColumns(
    _query: DriverQueryFn,
    fields: { name: string; dataTypeID: number; dataTypeName?: string }[],
    primaryKey: string[] = [],
  ): Promise<ColumnMetadata[]> {
    const primaryKeySet = new Set(primaryKey);
    return fields.map((field) => ({
      name: field.name,
      dataType: sql.mysqlTypeName(field.dataTypeID),
      nullable: true,
      isPrimaryKey: primaryKeySet.has(field.name),
      autoIncrement: false,
      defaultValue: null,
    }));
  }

  formatExplain(rows: Record<string, unknown>[]): string {
    return sql.mysqlFormatExplain(rows);
  }

  mapError(error: unknown, context: DriverErrorContext): void {
    const mysqlError = error as
      | {
          code?: string;
          errno?: number;
        }
      | undefined;
    const code = mysqlError?.code;
    const errno = mysqlError?.errno;

    if (context.operation === 'createTable' && (code === 'ER_TABLE_EXISTS_ERROR' || errno === 1050)) {
      throw new ConflictException(context.detail ?? 'Table already exists');
    }

    if (code === 'ER_DUP_ENTRY' || code === 'ER_DUP_KEYNAME' || errno === 1062 || errno === 1061) {
      throw new ConflictException('A row or key with that value already exists');
    }

    const validationCodes = new Set([
      'ER_BAD_FIELD_ERROR',
      'ER_NO_SUCH_TABLE',
      'ER_CANT_CREATE_TABLE',
      'ER_CANT_DROP_FIELD_OR_KEY',
      'ER_CANT_REMOVE_ALL_FIELDS',
      'ER_BAD_NULL_ERROR',
      'ER_INVALID_DEFAULT',
      'ER_NO_DEFAULT_FOR_FIELD',
      'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
      'ER_CHECK_CONSTRAINT_VIOLATED',
    ]);
    const validationErrnos = new Set([1005, 1048, 1054, 1067, 1090, 1091, 1146, 1364, 1366, 3819]);
    if (
      (code !== undefined && (validationCodes.has(code) || code.startsWith('ER_CANT_'))) ||
      (errno !== undefined && validationErrnos.has(errno))
    ) {
      throw new UnprocessableEntityException('MySQL rejected the requested database operation');
    }
  }
}
