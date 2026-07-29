import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Server as SshServer } from 'ssh2';
import { SshTunnelService, SshTunnelError, type TunnelHandle } from './ssh-tunnel.service';

// A throwaway RSA host key for the mock SSH server + a client key for the key-auth test.
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const clientPrivatePem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

/**
 * A minimal in-process SSH server that (optionally) requires the given auth. The tests only exercise the
 * SSH handshake + host-key verification + forward *setup* (they check the local port opens); no test
 * drives bytes through the forward, so we don't bridge the channel.
 */
async function startMockSsh(opts: { password?: string; acceptKey?: boolean } = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = new SshServer({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (opts.password !== undefined) {
        if (ctx.method === 'password' && ctx.password === opts.password) return ctx.accept();
        return ctx.reject(['password']);
      }
      if (opts.acceptKey) {
        if (ctx.method === 'publickey') return ctx.accept();
        return ctx.reject(['publickey']);
      }
      return ctx.reject();
    });
    client.on('ready', () => { /* accept the connection; no channels needed for these tests */ });
  });

  const port = await new Promise<number>((res) => server.listen(0, '127.0.0.1', () => res((server.address() as { port: number }).port)));
  return { port, close: () => new Promise<void>((res) => server.close(() => res())) };
}

describe('SshTunnelService', () => {
  const service = new SshTunnelService();
  let handles: TunnelHandle[] = [];
  let mock: Awaited<ReturnType<typeof startMockSsh>> | undefined;

  beforeEach(() => {
    handles = [];
  });
  afterEach(async () => {
    await Promise.all(handles.map((h) => h.close().catch(() => undefined)));
    await mock?.close();
    mock = undefined;
  });

  it('opens a tunnel with password auth and captures the host fingerprint (TOFU)', async () => {
    mock = await startMockSsh({ password: 'pw' });
    const handle = await service.open({
      sshHost: '127.0.0.1', sshPort: mock.port, sshUsername: 'u', authMethod: 'password', secret: 'pw',
      dbHost: '127.0.0.1', dbPort: 5432,
    });
    handles.push(handle);

    expect(handle.localPort).toBeGreaterThan(0);
    expect(handle.fingerprint).toMatch(/^SHA256:/);
    expect(handle.fingerprintIsNew).toBe(true); // no knownFingerprint supplied
  });

  it('opens a tunnel with private-key auth', async () => {
    mock = await startMockSsh({ acceptKey: true });
    const handle = await service.open({
      sshHost: '127.0.0.1', sshPort: mock.port, sshUsername: 'u', authMethod: 'key', secret: clientPrivatePem,
      dbHost: '127.0.0.1', dbPort: 5432,
    });
    handles.push(handle);
    expect(handle.localPort).toBeGreaterThan(0);
  });

  it('rejects a host-key mismatch against a pinned fingerprint (SSH_CONNECT stage)', async () => {
    mock = await startMockSsh({ password: 'pw' });
    await expect(
      service.open({
        sshHost: '127.0.0.1', sshPort: mock.port, sshUsername: 'u', authMethod: 'password', secret: 'pw',
        dbHost: '127.0.0.1', dbPort: 5432,
        knownFingerprint: 'SHA256:definitely-not-the-real-one',
      }),
    ).rejects.toMatchObject({ stage: 'ssh_connect' });
  });

  it('maps a bad password to the SSH_AUTH stage', async () => {
    mock = await startMockSsh({ password: 'right' });
    await expect(
      service.open({
        sshHost: '127.0.0.1', sshPort: mock.port, sshUsername: 'u', authMethod: 'password', secret: 'wrong',
        dbHost: '127.0.0.1', dbPort: 5432,
      }),
    ).rejects.toMatchObject({ stage: 'ssh_auth' });
  });

  it('maps an unreachable bastion to the SSH_CONNECT stage', async () => {
    // Nothing listening on this port.
    await expect(
      service.open({
        sshHost: '127.0.0.1', sshPort: 1, sshUsername: 'u', authMethod: 'password', secret: 'pw',
        dbHost: '127.0.0.1', dbPort: 5432,
      }),
    ).rejects.toBeInstanceOf(SshTunnelError);
  });
});
