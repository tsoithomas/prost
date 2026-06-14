import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { CryptoService } from '../common/crypto.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PgConnectionService } from './pg-connection.service';

// Typed interface exposing the private internals we need to inspect in tests.
interface PgConnectionServiceInternals {
  pools: Map<string, Promise<Pool>>;
  poolLastUsed: Map<string, number>;
  poolSize: number;
  poolIdleMs: number;
  poolMax: number;
  sweep: () => void;
}

function internals(svc: PgConnectionService): PgConnectionServiceInternals {
  return svc as unknown as PgConnectionServiceInternals;
}

// Minimal mock of a pg.Pool
function makePool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
}

function makeConfig(overrides: Record<string, string | number> = {}): ConfigService {
  const map: Record<string, string | number> = {
    QUERY_TIMEOUT_MS: 30_000,
    TARGET_POOL_SIZE: 5,
    TARGET_POOL_IDLE_MS: 600_000,
    TARGET_POOL_MAX: 20,
    ...overrides,
  };
  return { get: (key: string) => map[key] } as unknown as ConfigService;
}

function makePrisma(
  connection = {
    id: 'conn-1',
    host: 'localhost',
    port: 5432,
    database: 'db',
    username: 'u',
    encryptedCredentials: {},
    sslEnabled: false,
    sslRejectUnauthorized: true,
  },
): PrismaService {
  return { connection: { findUniqueOrThrow: vi.fn().mockResolvedValue(connection) } } as unknown as PrismaService;
}

function makeCrypto(): CryptoService {
  return { decrypt: vi.fn().mockReturnValue('password') } as unknown as CryptoService;
}

describe('PgConnectionService — pool lifecycle', () => {
  let pool: ReturnType<typeof makePool>;

  beforeEach(() => {
    pool = makePool();
    vi.mock('pg', () => ({
      Pool: vi.fn(() => pool),
      Client: vi.fn(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn() })),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads pool config values from ConfigService', () => {
    const config = makeConfig({ TARGET_POOL_SIZE: 3, TARGET_POOL_IDLE_MS: 5_000, TARGET_POOL_MAX: 10 });
    const svc = new PgConnectionService(makePrisma(), makeCrypto(), config);
    const i = internals(svc);
    expect(i.poolSize).toBe(3);
    expect(i.poolIdleMs).toBe(5_000);
    expect(i.poolMax).toBe(10);
  });

  it('onModuleInit starts the sweep interval; onModuleDestroy clears it', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(42 as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const svc = new PgConnectionService(makePrisma(), makeCrypto(), makeConfig());
    svc.onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalledOnce();

    await svc.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(42);
  });

  it('onModuleDestroy closes all cached pools', async () => {
    const svc = new PgConnectionService(makePrisma(), makeCrypto(), makeConfig());
    const { pools } = internals(svc);

    pools.set('conn-1', Promise.resolve(pool as unknown as Pool));
    pools.set('conn-2', Promise.resolve(pool as unknown as Pool));

    await svc.onModuleDestroy();

    expect(pool.end).toHaveBeenCalledTimes(2);
    expect(pools.size).toBe(0);
  });

  it('idle sweep evicts pools unused for longer than poolIdleMs', async () => {
    vi.useFakeTimers();
    const svc = new PgConnectionService(makePrisma(), makeCrypto(), makeConfig({ TARGET_POOL_IDLE_MS: 1_000 }));
    svc.onModuleInit();

    const { pools, poolLastUsed } = internals(svc);
    pools.set('conn-stale', Promise.resolve(pool as unknown as Pool));
    poolLastUsed.set('conn-stale', Date.now() - 2_000);

    // Advance past the sweep interval (poolIdleMs / 2 = 500ms)
    vi.advanceTimersByTime(600);
    await Promise.resolve();

    expect(pools.has('conn-stale')).toBe(false);
    expect(poolLastUsed.has('conn-stale')).toBe(false);

    vi.useRealTimers();
    await svc.onModuleDestroy();
  });

  it('LRU cap evicts least-recently-used pools when exceeding poolMax', async () => {
    const svc = new PgConnectionService(makePrisma(), makeCrypto(), makeConfig({ TARGET_POOL_MAX: 2 }));
    const { pools, poolLastUsed, sweep } = internals(svc);

    const now = Date.now();
    pools.set('conn-old', Promise.resolve(pool as unknown as Pool));
    poolLastUsed.set('conn-old', now - 3_000);
    pools.set('conn-mid', Promise.resolve(pool as unknown as Pool));
    poolLastUsed.set('conn-mid', now - 2_000);
    pools.set('conn-new', Promise.resolve(pool as unknown as Pool));
    poolLastUsed.set('conn-new', now - 1_000);

    sweep();
    await Promise.resolve();

    // poolMax=2: oldest (conn-old) evicted; newer two remain
    expect(pools.has('conn-old')).toBe(false);
    expect(pools.has('conn-mid')).toBe(true);
    expect(pools.has('conn-new')).toBe(true);
  });

  it('evictPool deletes pool and calls end()', async () => {
    const svc = new PgConnectionService(makePrisma(), makeCrypto(), makeConfig());
    const { pools, poolLastUsed } = internals(svc);

    pools.set('conn-1', Promise.resolve(pool as unknown as Pool));
    poolLastUsed.set('conn-1', Date.now());

    await svc.evictPool('conn-1');

    expect(pool.end).toHaveBeenCalledOnce();
    expect(pools.has('conn-1')).toBe(false);
    expect(poolLastUsed.has('conn-1')).toBe(false);
  });

  it('evictPool is a no-op for unknown connectionId', async () => {
    const svc = new PgConnectionService(makePrisma(), makeCrypto(), makeConfig());
    await expect(svc.evictPool('unknown')).resolves.toBeUndefined();
  });
});
