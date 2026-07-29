import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildSystemConnectionParams, isSystemConnectionId } from '../connections/system-connection';
import { DbDriverRegistry } from './db-driver.registry';
import type { DbDriver } from './db-driver.interface';
import { SshTunnelError, SshTunnelService, type SshEndpointConfig, type TunnelHandle } from './ssh-tunnel.service';
import type { ConnectionParams, DriverCursor, DriverQueryFn, DriverResult, NativePool, SqlFragment, TestConnectionResult } from './types';

/** Decrypted SSH config attached to a resolved connection (Phase 32); the `dbHost/dbPort` are filled in by `resolve`. */
type ResolvedSshConfig = SshEndpointConfig;

@Injectable()
export class PoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolManager.name);
  private readonly pools = new Map<string, Promise<NativePool>>();
  private readonly poolLastUsed = new Map<string, number>();
  private readonly poolEngine = new Map<string, string>();
  /** Open SSH tunnels keyed by connection id (Phase 32) — torn down with the pool in `evictPool`. */
  private readonly tunnels = new Map<string, TunnelHandle>();
  /** Count of open streaming cursors per connection — a held cursor pins a pooled client, so its pool must not be idle/LRU-evicted out from under it (architecture principle §12). */
  private readonly activeCursors = new Map<string, number>();
  private sweepInterval?: ReturnType<typeof setInterval>;

  private readonly poolIdleMs: number;
  private readonly poolMax: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: DbDriverRegistry,
    private readonly config: ConfigService,
    private readonly sshTunnel: SshTunnelService,
  ) {
    this.poolIdleMs = Number(config.get('TARGET_POOL_IDLE_MS') ?? 10 * 60_000);
    this.poolMax = Number(config.get('TARGET_POOL_MAX') ?? 20);
  }

  onModuleInit(): void {
    this.sweepInterval = setInterval(this.sweep, Math.floor(this.poolIdleMs / 2));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    await Promise.all([...this.pools.keys()].map((id) => this.evictPool(id)));
  }

  async run(connectionId: string, frag: SqlFragment): Promise<DriverResult> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    const start = Date.now();
    try {
      const r = await driver.query(pool, frag);
      this.logger.log(`target query ok connectionId=${connectionId} durationMs=${Date.now() - start}`);
      return r;
    } catch (error) {
      this.logger.warn(`target query failed connectionId=${connectionId} durationMs=${Date.now() - start} error=${error instanceof Error ? error.message : 'unknown'}`);
      throw error;
    }
  }

  async withSession<T>(connectionId: string, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    return driver.withSession(pool, fn);
  }

  /**
   * Open a forward-only streaming cursor on the connection's pool. The returned handle pins a
   * pooled client (PG/MySQL) or a statement iterator (SQLite) until `close()`; the count of open
   * cursors keeps the pool from being idle/LRU-evicted while one is live. The caller (the
   * cursor-session manager) is responsible for always closing it.
   */
  async openCursor(connectionId: string, frag: SqlFragment): Promise<DriverCursor> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    const cursor = await driver.openCursor(pool, frag);
    this.activeCursors.set(connectionId, (this.activeCursors.get(connectionId) ?? 0) + 1);
    this.logger.log(`cursor opened connectionId=${connectionId} active=${this.activeCursors.get(connectionId)}`);

    let released = false;
    const releaseAccounting = (): void => {
      if (released) return;
      released = true;
      const remaining = (this.activeCursors.get(connectionId) ?? 1) - 1;
      if (remaining <= 0) this.activeCursors.delete(connectionId);
      else this.activeCursors.set(connectionId, remaining);
    };

    return {
      fetch: (n) => {
        this.poolLastUsed.set(connectionId, Date.now());
        return cursor.fetch(n);
      },
      columns: () => cursor.columns(),
      close: async () => {
        try {
          await cursor.close();
        } finally {
          releaseAccounting();
        }
      },
    };
  }

  async withTransaction<T>(connectionId: string, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    return driver.withTransaction(pool, fn);
  }

  /** Engine-enforced read-only transaction (Phase 31 agentic read-query path). */
  async withReadOnlyTransaction<T>(connectionId: string, fn: (q: DriverQueryFn) => Promise<T>): Promise<T> {
    const { driver, pool } = await this.resolve(connectionId);
    this.poolLastUsed.set(connectionId, Date.now());
    return driver.withReadOnlyTransaction(pool, fn);
  }

  /**
   * Tests a connection, first opening an SSH tunnel when `ssh` is given (Phase 32). Reports which
   * **stage** it reached: an SSH failure returns `stage: 'ssh'` with the specific reason; otherwise the
   * driver tests through the tunnel (or directly) and the result is tagged `stage: 'db'`, carrying the
   * observed host-key fingerprint for the UI to show. The tunnel is always closed afterward.
   */
  async testConnection(engine: string, params: ConnectionParams, ssh?: ResolvedSshConfig): Promise<TestConnectionResult> {
    if (!ssh) return { ...(await this.registry.get(engine).testConnection(params)), stage: 'db' };

    let handle: TunnelHandle;
    try {
      handle = await this.sshTunnel.open({ ...ssh, dbHost: params.host, dbPort: params.port });
    } catch (error) {
      const message = error instanceof SshTunnelError ? error.message : 'SSH tunnel could not be established';
      return { ok: false, message, stage: 'ssh' };
    }
    try {
      const result = await this.registry.get(engine).testConnection({ ...params, host: '127.0.0.1', port: handle.localPort });
      return { ...result, stage: 'db', ...(handle.fingerprint ? { sshHostFingerprint: handle.fingerprint } : {}) };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * Resolves the driver for a connection by its `engine`, without forcing a pool to be created.
   * Feature services use this to reach the right dialect's SQL builders.
   */
  /**
   * Whether a connection is read-only (Phase 25 guardrail) — the virtual app-DB self-connection, or a
   * stored connection with its `readOnly` flag set. The single source of truth for the write guard.
   */
  async isReadOnly(connectionId: string): Promise<boolean> {
    if (isSystemConnectionId(connectionId)) return true;
    const { readOnly } = await this.prisma.connection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { readOnly: true },
    });
    return readOnly;
  }

  /** Throws `ForbiddenException` on a read-only connection. Called by every write entrypoint (grid/DDL/query). */
  async assertWritable(connectionId: string): Promise<void> {
    if (await this.isReadOnly(connectionId)) {
      throw new ForbiddenException('This connection is read-only');
    }
  }

  async driverFor(connectionId: string): Promise<DbDriver> {
    const cached = this.poolEngine.get(connectionId);
    if (cached) return this.registry.get(cached);
    if (isSystemConnectionId(connectionId)) {
      this.poolEngine.set(connectionId, 'sqlite');
      return this.registry.get('sqlite');
    }
    const { engine } = await this.prisma.connection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { engine: true },
    });
    this.poolEngine.set(connectionId, engine);
    return this.registry.get(engine);
  }

  async defaultNamespace(connectionId: string): Promise<string> {
    const driver = await this.driverFor(connectionId);
    if (driver.descriptor.defaultNamespace) return driver.descriptor.defaultNamespace;
    const { params } = await this.resolveConfig(connectionId);
    return params.database;
  }

  async evictPool(connectionId: string): Promise<void> {
    const cached = this.pools.get(connectionId);
    if (!cached) {
      // No pool, but a half-open tunnel could linger (e.g. an update evicting before first use) — close it.
      await this.closeTunnel(connectionId);
      return;
    }
    const engine = this.poolEngine.get(connectionId)!;
    this.pools.delete(connectionId);
    this.poolLastUsed.delete(connectionId);
    this.poolEngine.delete(connectionId);
    await cached.then((pool) => this.registry.get(engine).closePool(pool)).catch(() => undefined);
    // Tear the SSH tunnel down with its pool (Phase 32) — the idle/LRU sweep + shutdown route through here.
    await this.closeTunnel(connectionId);
    this.logger.log(`pool evicted connectionId=${connectionId}`);
  }

  private async closeTunnel(connectionId: string): Promise<void> {
    const tunnel = this.tunnels.get(connectionId);
    if (!tunnel) return;
    this.tunnels.delete(connectionId);
    await tunnel.close().catch(() => undefined);
  }

  private async resolve(connectionId: string): Promise<{ driver: DbDriver; pool: NativePool }> {
    const { engine, params, ssh } = await this.resolveConfig(connectionId);
    const driver = this.registry.get(engine);
    this.poolEngine.set(connectionId, engine);

    const cached = this.pools.get(connectionId);
    if (cached) {
      this.poolLastUsed.set(connectionId, Date.now());
      return { driver, pool: await cached };
    }

    const created = this.createPoolMaybeTunneled(connectionId, driver, params, ssh);
    this.pools.set(connectionId, created);
    this.poolLastUsed.set(connectionId, Date.now());
    created.catch(() => { this.pools.delete(connectionId); this.poolLastUsed.delete(connectionId); this.poolEngine.delete(connectionId); });
    return { driver, pool: await created };
  }

  /**
   * Opens the driver's pool, first establishing an SSH tunnel when the connection has one (Phase 32).
   * The tunnel opens a local forwarded port and the driver is pointed at `127.0.0.1:localPort` — it stays
   * SSH-unaware (§1). On first connect the observed host-key fingerprint is persisted (TOFU). A failure
   * *after* the tunnel is up tears the tunnel down so nothing leaks.
   */
  private async createPoolMaybeTunneled(
    connectionId: string,
    driver: DbDriver,
    params: ConnectionParams,
    ssh?: ResolvedSshConfig,
  ): Promise<NativePool> {
    if (!ssh) return driver.createPool(params);

    const handle = await this.sshTunnel.open({ ...ssh, dbHost: params.host, dbPort: params.port });
    this.tunnels.set(connectionId, handle);
    // TOFU: remember the jump host's fingerprint the first time we see it, so later connects can verify it.
    if (handle.fingerprintIsNew && handle.fingerprint) {
      await this.prisma.connection
        .update({ where: { id: connectionId }, data: { sshHostFingerprint: handle.fingerprint } })
        .catch(() => undefined);
    }
    try {
      return await driver.createPool({ ...params, host: '127.0.0.1', port: handle.localPort });
    } catch (error) {
      await handle.close().catch(() => undefined);
      this.tunnels.delete(connectionId);
      throw error;
    }
  }

  /**
   * Builds the engine + connection params for a connection id. The virtual app-DB self-connection
   * is synthesized from `DATABASE_URL` (read-only, no Prisma row, no credential decrypt); everything
   * else comes from its stored row with its credential decrypted in memory.
   */
  private async resolveConfig(connectionId: string): Promise<{ engine: string; params: ConnectionParams; ssh?: ResolvedSshConfig }> {
    if (isSystemConnectionId(connectionId)) {
      return { engine: 'sqlite', params: buildSystemConnectionParams(this.config.getOrThrow('DATABASE_URL')) };
    }
    const connection = await this.prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    const password = this.crypto.decrypt(connection.encryptedCredentials as unknown as EncryptedPayload);
    const ssh = this.resolveSshConfig(connection);
    return {
      engine: connection.engine,
      params: {
        host: connection.host, port: connection.port, database: connection.database,
        username: connection.username, password, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized,
        readOnly: connection.readOnly,
      },
      ...(ssh ? { ssh } : {}),
    };
  }

  /** Decrypts the SSH block for a connection that has tunneling enabled (Phase 32); `undefined` otherwise. */
  private resolveSshConfig(connection: {
    sshEnabled: boolean; sshHost: string | null; sshPort: number | null; sshUsername: string | null;
    sshAuthMethod: string | null; encryptedSshSecret: unknown; sshKeyPassphraseEncrypted: unknown; sshHostFingerprint: string | null;
  }): ResolvedSshConfig | undefined {
    if (!connection.sshEnabled || !connection.sshHost || !connection.sshUsername || !connection.encryptedSshSecret) {
      return undefined;
    }
    const secret = this.crypto.decrypt(connection.encryptedSshSecret as EncryptedPayload);
    const passphrase = connection.sshKeyPassphraseEncrypted
      ? this.crypto.decrypt(connection.sshKeyPassphraseEncrypted as EncryptedPayload)
      : undefined;
    return {
      sshHost: connection.sshHost,
      sshPort: connection.sshPort ?? 22,
      sshUsername: connection.sshUsername,
      authMethod: connection.sshAuthMethod === 'password' ? 'password' : 'key',
      secret,
      ...(passphrase ? { passphrase } : {}),
      ...(connection.sshHostFingerprint ? { knownFingerprint: connection.sshHostFingerprint } : {}),
    };
  }

  /** A pool with live streaming cursors must not be torn down — its clients are still checked out. */
  private hasActiveCursors(connectionId: string): boolean {
    return (this.activeCursors.get(connectionId) ?? 0) > 0;
  }

  private readonly sweep = (): void => {
    const now = Date.now();
    for (const [connectionId, lastUsed] of [...this.poolLastUsed.entries()].sort((a, b) => a[1] - b[1])) {
      if (now - lastUsed > this.poolIdleMs && !this.hasActiveCursors(connectionId)) {
        this.logger.log(`pool idle sweep evicting connectionId=${connectionId} idleMs=${now - lastUsed}`);
        void this.evictPool(connectionId);
      }
    }
    const evictable = [...this.pools.keys()].filter((id) => !this.hasActiveCursors(id));
    if (evictable.length > this.poolMax) {
      const lru = [...this.poolLastUsed.entries()]
        .filter(([id]) => !this.hasActiveCursors(id))
        .sort((a, b) => a[1] - b[1])
        .slice(0, evictable.length - this.poolMax);
      for (const [connectionId] of lru) {
        this.logger.log(`pool LRU cap evicting connectionId=${connectionId}`);
        void this.evictPool(connectionId);
      }
    }
  };
}
