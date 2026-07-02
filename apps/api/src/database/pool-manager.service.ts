import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildSystemConnectionParams, isSystemConnectionId } from '../connections/system-connection';
import { DbDriverRegistry } from './db-driver.registry';
import type { DbDriver } from './db-driver.interface';
import type { ConnectionParams, DriverCursor, DriverQueryFn, DriverResult, NativePool, SqlFragment, TestConnectionResult } from './types';

@Injectable()
export class PoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolManager.name);
  private readonly pools = new Map<string, Promise<NativePool>>();
  private readonly poolLastUsed = new Map<string, number>();
  private readonly poolEngine = new Map<string, string>();
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

  async testConnection(engine: string, params: ConnectionParams): Promise<TestConnectionResult> {
    return this.registry.get(engine).testConnection(params);
  }

  /**
   * Resolves the driver for a connection by its `engine`, without forcing a pool to be created.
   * Feature services use this to reach the right dialect's SQL builders.
   */
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
    if (!cached) return;
    const engine = this.poolEngine.get(connectionId)!;
    this.pools.delete(connectionId);
    this.poolLastUsed.delete(connectionId);
    this.poolEngine.delete(connectionId);
    await cached.then((pool) => this.registry.get(engine).closePool(pool)).catch(() => undefined);
    this.logger.log(`pool evicted connectionId=${connectionId}`);
  }

  private async resolve(connectionId: string): Promise<{ driver: DbDriver; pool: NativePool }> {
    const { engine, params } = await this.resolveConfig(connectionId);
    const driver = this.registry.get(engine);
    this.poolEngine.set(connectionId, engine);

    const cached = this.pools.get(connectionId);
    if (cached) {
      this.poolLastUsed.set(connectionId, Date.now());
      return { driver, pool: await cached };
    }

    const created = driver.createPool(params);
    this.pools.set(connectionId, created);
    this.poolLastUsed.set(connectionId, Date.now());
    created.catch(() => { this.pools.delete(connectionId); this.poolLastUsed.delete(connectionId); this.poolEngine.delete(connectionId); });
    return { driver, pool: await created };
  }

  /**
   * Builds the engine + connection params for a connection id. The virtual app-DB self-connection
   * is synthesized from `DATABASE_URL` (read-only, no Prisma row, no credential decrypt); everything
   * else comes from its stored row with its credential decrypted in memory.
   */
  private async resolveConfig(connectionId: string): Promise<{ engine: string; params: ConnectionParams }> {
    if (isSystemConnectionId(connectionId)) {
      return { engine: 'sqlite', params: buildSystemConnectionParams(this.config.getOrThrow('DATABASE_URL')) };
    }
    const connection = await this.prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    const password = this.crypto.decrypt(connection.encryptedCredentials as unknown as EncryptedPayload);
    return {
      engine: connection.engine,
      params: {
        host: connection.host, port: connection.port, database: connection.database,
        username: connection.username, password, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized,
      },
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
