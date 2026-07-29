import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { CryptoService } from '../common/crypto.service';
import type { DbDriverRegistry } from './db-driver.registry';
import type { DbDriver } from './db-driver.interface';
import type { SshTunnelService, TunnelHandle } from './ssh-tunnel.service';
import { PoolManager } from './pool-manager.service';

/** A stored connection row with SSH enabled (secrets are opaque here; crypto is mocked). */
function sshConnectionRow() {
  return {
    id: 'conn-1', engine: 'postgres', host: 'db.internal', port: 5432, database: 'app', username: 'app',
    encryptedCredentials: { iv: 'i', tag: 't', data: 'd' }, sslEnabled: false, sslRejectUnauthorized: true, readOnly: false,
    sshEnabled: true, sshHost: 'bastion', sshPort: 22, sshUsername: 'jump', sshAuthMethod: 'key',
    encryptedSshSecret: { iv: 'i', tag: 't', data: 'd' }, sshKeyPassphraseEncrypted: null, sshHostFingerprint: null,
  };
}

function setup(row: ReturnType<typeof sshConnectionRow> | { sshEnabled: false } & Record<string, unknown>) {
  const closeTunnel = vi.fn().mockResolvedValue(undefined);
  const handle: TunnelHandle = { localPort: 54321, fingerprint: 'SHA256:abc', fingerprintIsNew: true, close: closeTunnel };
  const open = vi.fn().mockResolvedValue(handle);
  const sshTunnel = { open } as unknown as SshTunnelService;

  const createPool = vi.fn().mockResolvedValue({ pool: true });
  const closePool = vi.fn().mockResolvedValue(undefined);
  const driver = { createPool, closePool } as unknown as DbDriver;
  const registry = { get: vi.fn().mockReturnValue(driver) } as unknown as DbDriverRegistry;

  const update = vi.fn().mockResolvedValue(undefined);
  const prisma = { connection: { findUniqueOrThrow: vi.fn().mockResolvedValue(row), update } } as unknown as PrismaService;
  const crypto = { decrypt: vi.fn().mockReturnValue('secret') } as unknown as CryptoService;
  const config = { get: vi.fn().mockReturnValue(undefined), getOrThrow: vi.fn() } as unknown as ConfigService;

  const pool = new PoolManager(prisma, crypto, registry, config, sshTunnel);
  return { pool, open, createPool, closeTunnel, update };
}

describe('PoolManager — SSH tunnel lifecycle (Phase 32)', () => {
  it('opens the tunnel before createPool and points the driver at the local endpoint', async () => {
    const { pool, open, createPool } = setup(sshConnectionRow());

    await pool.run('conn-1', { sql: 'SELECT 1', params: [] }).catch(() => undefined);

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ sshHost: 'bastion', dbHost: 'db.internal', dbPort: 5432 }));
    // The driver connects to 127.0.0.1:<tunnel local port>, not the real DB host.
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 54321 }));
    // open() resolved before createPool() was called.
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(createPool.mock.invocationCallOrder[0]!);
  });

  it('persists the captured fingerprint on first connect (TOFU)', async () => {
    const { pool, update } = setup(sshConnectionRow());
    await pool.run('conn-1', { sql: 'SELECT 1', params: [] }).catch(() => undefined);
    expect(update).toHaveBeenCalledWith({ where: { id: 'conn-1' }, data: { sshHostFingerprint: 'SHA256:abc' } });
  });

  it('tears the tunnel down when the pool is evicted', async () => {
    const { pool, closeTunnel } = setup(sshConnectionRow());
    await pool.run('conn-1', { sql: 'SELECT 1', params: [] }).catch(() => undefined);
    await pool.evictPool('conn-1');
    expect(closeTunnel).toHaveBeenCalled();
  });

  it('does not open a tunnel for a non-SSH connection', async () => {
    const nonSsh = { ...sshConnectionRow(), sshEnabled: false as const, sshHost: null };
    const { pool, open, createPool } = setup(nonSsh);
    await pool.run('conn-1', { sql: 'SELECT 1', params: [] }).catch(() => undefined);
    expect(open).not.toHaveBeenCalled();
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ host: 'db.internal', port: 5432 }));
  });
});
