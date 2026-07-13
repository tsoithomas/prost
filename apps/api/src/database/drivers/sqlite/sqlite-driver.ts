import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import type {
  AlterTableOperation,
  ColumnMetadata,
  CreateIndexRequest,
  CreateTableRequest,
  DbEngineDescriptor,
  SchemaObjectKind,
} from '@prost/shared-types';
import type { DbDriver, DriverErrorContext } from '../../db-driver.interface';
import type {
  ConnectionParams, DbCapabilities, DriverCursor, DriverQueryFn, DriverResult, NativePool, RowUpdateGuard, SelectRowsOptions, SqlFragment, TableRef, TestConnectionResult, WhereDialect,
} from '../../types';
import * as sql from './sqlite-sql';

type Db = Database.Database;

const BUSY_TIMEOUT_MS = 5000;

/** better-sqlite3 only binds numbers, strings, bigints, buffers, and null. */
function normalizeBind(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

function leadingKeyword(text: string): string {
  return /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase() ?? '';
}

@Injectable()
export class SqliteDriver implements DbDriver {
  readonly engine = 'sqlite';
  readonly descriptor: DbEngineDescriptor = {
    engine: 'sqlite',
    label: 'SQLite',
    connectionMode: 'file',
    uriSchemes: [],
    parserDialect: 'sqlite',
    formatterDialect: 'sqlite',
    namespaceLabel: 'Database',
    defaultNamespace: 'main',
    supportsSsl: false,
    sslEnabledByDefault: false,
    supportsCursors: true,
    ddl: {
      columnTypes: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
      defaultExamples: ['0', "''", 'CURRENT_TIMESTAMP', 'null'],
      indexMethods: [],
      supportsAutoIncrement: false,
      supportsUsingExpression: false,
    },
    objects: {
      views: true, materializedViews: false, sequences: false,
      functions: false, procedures: false, triggers: true, enums: false,
    },
  };
  readonly capabilities: DbCapabilities = { supportsReturning: true, supportsSchemas: false, parserDialect: 'sqlite', concurrency: 'preimage', supportsCursors: true };

  private readonly busyTimeoutMs: number;

  constructor(config: ConfigService) {
    this.busyTimeoutMs = Number(config.get('QUERY_TIMEOUT_MS') ?? BUSY_TIMEOUT_MS);
  }

  async createPool(params: ConnectionParams): Promise<NativePool> {
    // `database` carries the file path (or `:memory:`). fileMustExist avoids silently creating
    // a stray empty DB when the configured path is wrong — this engine is for inspection.
    // `readonly` (the app-DB self-connection) makes SQLite reject every write at the engine level.
    const db = new Database(params.database, {
      readonly: params.readOnly ?? false,
      fileMustExist: params.database !== ':memory:',
    });
    db.pragma(`busy_timeout = ${this.busyTimeoutMs}`);
    return db;
  }

  async closePool(pool: NativePool): Promise<void> {
    (pool as Db).close();
  }

  async query(pool: NativePool, frag: SqlFragment): Promise<DriverResult> {
    const db = pool as Db;
    const stmt = db.prepare(frag.sql);
    const params = frag.params.map(normalizeBind);
    const command = leadingKeyword(frag.sql);

    if (stmt.reader) {
      const rows = stmt.all(...params) as DriverResult['rows'];
      const fields = stmt.columns().map((c) => ({ name: c.name, dataTypeID: 0, dataTypeName: c.type ?? undefined }));
      return { rows, fields, rowCount: rows.length, command };
    }

    const info = stmt.run(...params);
    return { rows: [], fields: [], rowCount: Number(info.changes), command };
  }

  async withSession<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const db = pool as Db;
    const query: DriverQueryFn = (frag) => this.query(db, frag);
    db.prepare('BEGIN').run();
    try {
      const result = await fn(query);
      db.prepare('COMMIT').run();
      return result;
    } catch (error) {
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        /* no active transaction */
      }
      throw error;
    }
  }

  async withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const db = pool as Db;
    const query: DriverQueryFn = (frag) => this.query(db, frag);
    try {
      db.prepare('BEGIN').run();
      const result = await fn(query);
      db.prepare('COMMIT').run();
      return result;
    } catch (error) {
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        /* no active transaction */
      }
      throw error;
    }
  }

  async openCursor(pool: NativePool, frag: SqlFragment): Promise<DriverCursor> {
    // In-process and synchronous: the cursor is a prepared-statement iterator (no pooled client to
    // hold). better-sqlite3 keeps the statement busy until the iterator is exhausted or `.return()`d,
    // so close() must always run — that is what releases the read lock.
    const db = pool as Db;
    const stmt = db.prepare(frag.sql);
    if (!stmt.reader) {
      throw new UnprocessableEntityException('Only SELECT statements can be streamed');
    }
    const params = frag.params.map(normalizeBind);
    const fields = stmt.columns().map((c) => ({ name: c.name, dataTypeID: 0, dataTypeName: c.type ?? undefined }));
    const iter = stmt.iterate(...params) as IterableIterator<Record<string, unknown>>;
    let closed = false;

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      iter.return?.();
    };

    return {
      async fetch(n) {
        const rows: Record<string, unknown>[] = [];
        let complete = false;
        for (let i = 0; i < n; i += 1) {
          const next = iter.next();
          if (next.done) {
            complete = true;
            break;
          }
          rows.push(next.value);
        }
        if (complete) await close();
        return { rows, complete };
      },
      columns: () => fields,
      close,
    };
  }

  async testConnection(params: ConnectionParams): Promise<TestConnectionResult> {
    let db: Db | undefined;
    try {
      db = new Database(params.database, { fileMustExist: params.database !== ':memory:' });
      const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string } | undefined;
      return { ok: true, message: 'Connection successful', serverVersion: row?.v };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' };
    } finally {
      db?.close();
    }
  }

  quoteIdent = sql.sqliteQuoteIdent;
  placeholder = sql.sqlitePlaceholder;

  readonly whereDialect: WhereDialect = {
    placeholder: sql.sqlitePlaceholder,
    quoteIdent: sql.sqliteQuoteIdent,
    likeOperator: 'LIKE',
    inList: (column, values, negated, firstIndex) => {
      if (values.length === 0) return { fragment: negated ? '1=1' : '1=0', params: [] };
      const phs = values.map((_, i) => sql.sqlitePlaceholder(firstIndex + i)).join(', ');
      return { fragment: `${column} ${negated ? 'NOT IN' : 'IN'} (${phs})`, params: [...values] };
    },
  };

  buildListTables = sql.sqliteBuildListTables;
  buildListAllColumns = sql.sqliteBuildListAllColumns;
  buildListColumns = (ref: TableRef) => sql.sqliteBuildListColumns(ref);
  buildListIndexes = (ref: TableRef) => sql.sqliteBuildListIndexes(ref);
  buildListForeignKeys = (ref: TableRef) => sql.sqliteBuildListForeignKeys(ref);
  buildListReferencingForeignKeys = (ref: TableRef) => sql.sqliteBuildListReferencingForeignKeys(ref);
  buildListAllSchemaObjects = () => sql.sqliteBuildListAllSchemaObjects();
  buildObjectDefinition = (kind: SchemaObjectKind, ref: TableRef) => sql.sqliteBuildObjectDefinition(kind, ref);
  buildSchemaTableStats = (namespace: string) => sql.sqliteBuildSchemaTableStats(namespace);
  buildSelectRows = (ref: TableRef, opts: SelectRowsOptions) => sql.sqliteBuildSelectRows(ref, opts);
  buildFilteredRowCount = (ref: TableRef, w: string, p: unknown[]) => sql.sqliteBuildFilteredRowCount(ref, w, p);
  buildRowCountEstimate = (ref: TableRef) => sql.sqliteBuildRowCountEstimate(ref);
  buildInsertRow = (ref: TableRef, e: [string, unknown][]) => sql.sqliteBuildInsertRow(ref, e);
  buildUpdateRow = (ref: TableRef, c: string, v: unknown, pk: string[], pv: unknown[]) => sql.sqliteBuildUpdateRow(ref, c, v, pk, pv);
  buildUpdateRowGuarded = (ref: TableRef, e: [string, unknown][], pk: string[], pv: unknown[], g: RowUpdateGuard) =>
    sql.sqliteBuildUpdateRowGuarded(ref, e, pk, pv, g);
  async insertRow(
    q: DriverQueryFn,
    ref: TableRef,
    entries: [string, unknown][],
    _columns: ColumnMetadata[],
  ): Promise<Record<string, unknown>> {
    const r = await q(sql.sqliteBuildInsertRow(ref, entries));
    return r.rows[0] as Record<string, unknown>;
  }

  async updateRow(
    q: DriverQueryFn,
    ref: TableRef,
    column: string,
    value: unknown,
    primaryKey: string[],
    primaryKeyValues: unknown[],
  ): Promise<Record<string, unknown>> {
    const r = await q(sql.sqliteBuildUpdateRow(ref, column, value, primaryKey, primaryKeyValues));
    if (r.rowCount !== 1) {
      throw new NotFoundException(`Row in "${ref.namespace ?? ''}.${ref.name}" no longer exists — it may have been changed or deleted`);
    }
    return r.rows[0] as Record<string, unknown>;
  }

  buildDeleteRow = (ref: TableRef, pk: string[], pv: unknown[]) => sql.sqliteBuildDeleteRow(ref, pk, pv);
  normalizeCreateTable = (req: CreateTableRequest) => sql.sqliteNormalizeCreateTable(req, this.descriptor.ddl.columnTypes);
  normalizeAlterTable = (ref: TableRef, op: AlterTableOperation, columns: ColumnMetadata[]) =>
    sql.sqliteNormalizeAlterTable(ref, op, columns, this.descriptor.ddl.columnTypes);
  normalizeCreateIndex = (req: CreateIndexRequest) => sql.sqliteNormalizeCreateIndex(req);
  buildCreateTable = (req: CreateTableRequest) => sql.sqliteBuildCreateTable(req);
  buildAlterTable = (ref: TableRef, op: AlterTableOperation) => sql.sqliteBuildAlterTable(ref, op);
  buildCreateIndex = (req: CreateIndexRequest, name: string, method: string) => sql.sqliteBuildCreateIndex(req, name, method);
  buildDropIndex = (ref: TableRef, indexName: string) => sql.sqliteBuildDropIndex(ref, indexName);
  buildDropTable = (ref: TableRef) => sql.sqliteBuildDropTable(ref);
  buildTruncateTable = (ref: TableRef) => sql.sqliteBuildTruncateTable(ref);

  async describeResultColumns(
    _query: DriverQueryFn,
    fields: { name: string; dataTypeID: number; dataTypeName?: string }[],
    primaryKey: string[] = [],
  ): Promise<ColumnMetadata[]> {
    const primaryKeySet = new Set(primaryKey);
    return fields.map((field) => ({
      name: field.name,
      dataType: field.dataTypeName ?? 'unknown',
      nullable: true,
      isPrimaryKey: primaryKeySet.has(field.name),
      autoIncrement: false,
      defaultValue: null,
    }));
  }

  formatExplain(rows: Record<string, unknown>[]): string {
    return rows.map((row) => String(row['QUERY PLAN'] ?? row.detail ?? '')).join('\n');
  }

  mapError(error: unknown, ctx: DriverErrorContext): void {
    const message = (error as { message?: string } | undefined)?.message ?? '';
    if (ctx.operation === 'createTable' && /already exists/i.test(message)) {
      throw new ConflictException(ctx.detail ?? 'Table already exists');
    }
    if (ctx.operation === 'createIndex' && /already exists/i.test(message)) {
      throw new ConflictException('An index with that name already exists');
    }
    if (ctx.operation === 'dropIndex' && /no such index/i.test(message)) {
      throw new UnprocessableEntityException('Index does not exist');
    }
    if (ctx.operation === 'alterTable') {
      if (/duplicate column/i.test(message)) throw new ConflictException('Column already exists');
      if (/no such column/i.test(message)) throw new UnprocessableEntityException('Column does not exist');
    }
  }
}
