import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { DbDriverRegistry } from './db-driver.registry';
import type { DbDriver } from './db-driver.interface';
import type { ConnectionParams, DriverQueryFn, DriverResult, NativePool, SqlFragment, TestConnectionResult } from './types';

@Injectable()
export class PoolManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolManager.name);
  private readonly pools = new Map<string, Promise<NativePool>>();
  private readonly poolLastUsed = new Map<string, number>();
  private readonly poolEngine = new Map<string, string>();
  private sweepInterval?: ReturnType<typeof setInterval>;

  private readonly poolIdleMs: number;
  private readonly poolMax: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: DbDriverRegistry,
    config: ConfigService,
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
    const { engine } = await this.prisma.connection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { engine: true },
    });
    this.poolEngine.set(connectionId, engine);
    return this.registry.get(engine);
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
    const connection = await this.prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    const driver = this.registry.get(connection.engine);
    this.poolEngine.set(connectionId, connection.engine);

    const cached = this.pools.get(connectionId);
    if (cached) {
      this.poolLastUsed.set(connectionId, Date.now());
      return { driver, pool: await cached };
    }

    const password = this.crypto.decrypt(connection.encryptedCredentials as unknown as EncryptedPayload);
    const params: ConnectionParams = {
      host: connection.host, port: connection.port, database: connection.database,
      username: connection.username, password, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized,
    };
    const created = driver.createPool(params);
    this.pools.set(connectionId, created);
    this.poolLastUsed.set(connectionId, Date.now());
    created.catch(() => { this.pools.delete(connectionId); this.poolLastUsed.delete(connectionId); this.poolEngine.delete(connectionId); });
    return { driver, pool: await created };
  }

  private readonly sweep = (): void => {
    const now = Date.now();
    for (const [connectionId, lastUsed] of [...this.poolLastUsed.entries()].sort((a, b) => a[1] - b[1])) {
      if (now - lastUsed > this.poolIdleMs) {
        this.logger.log(`pool idle sweep evicting connectionId=${connectionId} idleMs=${now - lastUsed}`);
        void this.evictPool(connectionId);
      }
    }
    const active = [...this.pools.keys()];
    if (active.length > this.poolMax) {
      const lru = [...this.poolLastUsed.entries()].sort((a, b) => a[1] - b[1]).slice(0, active.length - this.poolMax);
      for (const [connectionId] of lru) {
        this.logger.log(`pool LRU cap evicting connectionId=${connectionId}`);
        void this.evictPool(connectionId);
      }
    }
  };
}
