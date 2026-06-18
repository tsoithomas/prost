/** Supported target database engines. SQLite is file-based (the `database` field is a path). */
export type DbEngine = 'postgres' | 'mysql' | 'sqlite';

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
  ddl: {
    columnTypes: string[];
    defaultExamples: string[];
    indexMethods: string[];
    supportsAutoIncrement: boolean;
    supportsUsingExpression: boolean;
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
