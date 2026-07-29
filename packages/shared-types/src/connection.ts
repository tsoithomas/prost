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
  /** Whether the engine exposes live sessions for the activity monitor + kill-query (Phase 27; SQLite: false). */
  supportsSessionMonitoring: boolean;
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

/** SSH auth method for a tunneled connection (Phase 32). */
export type SshAuthMethod = 'key' | 'password';

/**
 * The non-secret SSH tunnel fields surfaced on `ConnectionDto` (Phase 32). Present only when
 * `sshEnabled`. The private key / password / passphrase are **write-only** and never appear here,
 * exactly like the DB password. `sshHostFingerprint` is captured trust-on-first-use.
 */
export interface SshConnectionInfo {
  sshEnabled: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: SshAuthMethod;
  /** The jump host's key fingerprint, stored on first connect and verified thereafter (TOFU). */
  sshHostFingerprint?: string;
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
  /** SSH tunnel config (non-secret fields only), Phase 32. */
  ssh: SshConnectionInfo;
  capabilities: ConnectionCapabilities;
  createdAt: string;
  updatedAt: string;
}

/**
 * SSH tunnel input (Phase 32) — the secret fields are write-only (sent on create/update, never
 * returned). Included on create/update/test DTOs when the user enables SSH.
 */
export interface SshConnectionInput {
  sshEnabled: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: SshAuthMethod;
  /** Private key (key auth) or password (password auth). Write-only. */
  sshSecret?: string;
  /** Optional passphrase protecting the private key (key auth only). Write-only. */
  sshKeyPassphrase?: string;
}

export interface CreateConnectionDto extends Partial<SshConnectionInput> {
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

/**
 * All fields optional; an empty/omitted `password` means "keep the stored credential". Likewise an
 * empty/omitted `sshSecret` keeps the stored SSH secret.
 */
export interface UpdateConnectionDto extends Partial<SshConnectionInput> {
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
export interface TestConnectionDto extends Partial<SshConnectionInput> {
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
  /** Which stage failed/succeeded, so the UI can distinguish SSH-tunnel from DB errors (Phase 32). */
  stage?: 'ssh' | 'db';
  /** The jump host's key fingerprint observed during a successful SSH test (shown for confirmation). */
  sshHostFingerprint?: string;
}
