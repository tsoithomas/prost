import type { QueryResultRow } from 'pg';
import type { TestConnectionResult } from '@prost/shared-types';

/** Neutral table reference. PG maps `namespace` → schema. */
export interface TableRef {
  namespace?: string;
  name: string;
}

/** Parameterized SQL emitted by a driver builder. Values always bind as params. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/** Engine-neutral query result (mirrors pg's result shape today). */
export interface DriverResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  /**
   * `dataTypeID` is the engine's native type id (PG OID). Drivers that already know the
   * type name (e.g. SQLite, from prepared-statement column metadata) may also set
   * `dataTypeName`, letting the query layer skip a catalog round-trip via
   * `buildResolveTypeNames`.
   */
  fields: { name: string; dataTypeID: number; dataTypeName?: string }[];
  rowCount: number | null;
  command: string;
}

export interface DbCapabilities {
  supportsReturning: boolean;
  supportsSchemas: boolean;
  parserDialect: 'postgresql' | 'sqlite';
}

/**
 * The dialect-specific pieces of WHERE-clause compilation (`apps/api/src/grid/filter.ts`).
 * Owned by each driver so the grid filter compiler stays engine-neutral. Beyond quoting and
 * placeholders, drivers diverge on case-insensitive matching (PG `ILIKE` vs SQLite `LIKE`)
 * and set membership (PG `= ANY($1)` with one array param vs SQLite `IN (?, ?)` with N params).
 */
export interface WhereDialect {
  placeholder: (index: number) => string;
  quoteIdent: (identifier: string) => string;
  /** Keyword for case-insensitive LIKE: PG `ILIKE`, SQLite `LIKE` (ASCII-insensitive by default). */
  likeOperator: string;
  /** Renders an `IN` / `NOT IN` membership test and the params it binds. `firstIndex` is the 1-based param index for the first bound value. */
  inList: (
    column: string,
    values: unknown[],
    negated: boolean,
    firstIndex: number,
  ) => { fragment: string; params: unknown[] };
}

export interface ConnectionParams {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  /** Only meaningful when `sslEnabled` is true. `false` allows self-signed/unverifiable certs. */
  sslRejectUnauthorized: boolean;
}

export interface SelectRowsOptions {
  whereClause: string; // already-compiled, dialect-neutral via the driver's placeholder()
  whereParams: unknown[];
  orderColumn?: string;
  sortDir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/** Opaque to callers; only the owning driver knows the concrete type. */
export type NativePool = unknown;
export type DriverQueryFn = (frag: SqlFragment) => Promise<DriverResult>;

export type { TestConnectionResult };
