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
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
}

export interface DbCapabilities {
  supportsReturning: boolean;
  supportsSchemas: boolean;
  parserDialect: 'postgresql';
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
