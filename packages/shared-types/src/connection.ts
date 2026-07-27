/** Supported target database engines. SQLite is file-based (the `database` field is a path). */
export type DbEngine = 'postgres' | 'mysql' | 'sqlite';

/**
 * Per-connection environment label (Phase 25). Drives an unmistakable visual treatment for `prod`
 * (and `staging`) via the per-connection theme override, and is purely presentational — the
 * `readOnly` guard, not this label, is what actually blocks writes.
 */
export type ConnectionEnvironment = 'dev' | 'staging' | 'prod';

/** The set of valid environment values, for runtime validation (backend `@IsIn`, frontend selector). */
export const CONNECTION_ENVIRONMENTS: readonly ConnectionEnvironment[] = ['dev', 'staging', 'prod'];

/**
 * Id of the virtual app-DB self-connection (see the API's `system-connection.ts`). It is permanent,
 * undeletable, and uneditable — distinct from a *user* connection that merely has the `readOnly`
 * flag set. Both boundaries consume this so "is the system connection" is never confused with
 * "is read-only" (which any connection can now be, per Phase 25).
 */
export const SYSTEM_CONNECTION_ID = '__app_db__';

export function isSystemConnectionId(id: string): boolean {
  return id === SYSTEM_CONNECTION_ID;
}

export interface DbEngineDescriptor {
  engine: DbEngine;
  label: string;
  connectionMode: 'network' | 'file';
  defaultPort?: number;
  uriSchemes: string[];
  parserDialect: 'postgresql' | 'mysql' | 'sqlite';
  formatterDialect: 'postgresql' | 'mysql' | 'sqlite';
  namespaceLabel: string;
  defaultNamespace?: string;
  supportsSsl: boolean;
  sslEnabledByDefault: boolean;
  /** Whether the engine supports forward-only server-side cursors for streaming large editor results. */
  supportsCursors: boolean;
  /** Whether the engine produces a structured query plan the frontend renders as a tree (Phase 26). */
  supportsQueryPlan: boolean;
  /** Whether `EXPLAIN ANALYZE` (actual timings — runs the statement) is offered for this engine. */
  supportsExplainAnalyze: boolean;
  ddl: {
    columnTypes: string[];
    defaultExamples: string[];
    indexMethods: string[];
    supportsAutoIncrement: boolean;
    supportsUsingExpression: boolean;
    /** Whether the engine supports `ALTER TABLE ADD/DROP` foreign-key constraints (SQLite does not). */
    supportsForeignKeyDdl: boolean;
  };
  /** Which non-table schema-object kinds this engine exposes for read-only browsing (Phase 24). */
  objects: {
    views: boolean;
    materializedViews: boolean;
    sequences: boolean;
    functions: boolean;
    procedures: boolean;
    triggers: boolean;
    enums: boolean;
  };
}

/**
 * Engine/connection capabilities the UI branches on, so behavior stays engine-neutral (a new
 * engine slots in by reporting its capabilities rather than scattering `engine === 'x'` checks).
 */
export interface ConnectionCapabilities {
  /** Whether the engine has a schema layer (Postgres) vs a flat table list (SQLite). */
  hasSchemas: boolean;
  /** Whether the connection is read-only (e.g. the app-DB self-connection). */
  readOnly: boolean;
}

export interface ConnectionDto {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  sslEnabled: boolean;
  /** Only meaningful when `sslEnabled` is true. Defaults to `true` (verify the server certificate). */
  sslRejectUnauthorized: boolean;
  /** Environment label (Phase 25); drives prod/staging theming. Read-only state lives in `capabilities.readOnly`. */
  environment: ConnectionEnvironment;
  capabilities: ConnectionCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionDto {
  name: string;
  engine?: DbEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  sslRejectUnauthorized: boolean;
  environment: ConnectionEnvironment;
  /** When true, the server rejects every mutating operation on this connection (Phase 25). */
  readOnly: boolean;
}

/** All fields optional; an empty/omitted `password` means "keep the stored credential". */
export interface UpdateConnectionDto {
  name?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslEnabled?: boolean;
  sslRejectUnauthorized?: boolean;
  environment?: ConnectionEnvironment;
  readOnly?: boolean;
}

/**
 * Tests either a saved connection (`id`, falling back to its stored credentials when
 * `password` is blank) or an unsaved set of connection params (all fields required).
 */
export interface TestConnectionDto {
  id?: string;
  engine?: DbEngine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslEnabled?: boolean;
  sslRejectUnauthorized?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  serverVersion?: string;
}
