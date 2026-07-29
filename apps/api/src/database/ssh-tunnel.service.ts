import { Injectable, Logger } from '@nestjs/common';
import { createServer, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { Client, type ClientChannel } from 'ssh2';

/** Which stage of establishing an SSH tunnel failed — surfaced so the UI can be specific (§11). */
export type SshFailureStage = 'ssh_connect' | 'ssh_auth' | 'ssh_forward';

/** A typed tunnel failure carrying the stage. */
export class SshTunnelError extends Error {
  constructor(
    readonly stage: SshFailureStage,
    message: string,
  ) {
    super(message);
    this.name = 'SshTunnelError';
  }
}

/** The decrypted SSH auth + endpoint, without the DB target (which the caller fills in). */
export interface SshEndpointConfig {
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  authMethod: 'key' | 'password';
  /** The private key (key auth) or password (password auth), decrypted in memory. */
  secret: string;
  /** Passphrase protecting the private key (key auth only). */
  passphrase?: string;
  /** TOFU: when set, the jump host's fingerprint must match this or the connect is rejected. */
  knownFingerprint?: string;
}

export interface SshTunnelConfig extends SshEndpointConfig {
  /** The target DB host/port the tunnel forwards to (as seen from the jump host). */
  dbHost: string;
  dbPort: number;
}

export interface TunnelHandle {
  /** Local 127.0.0.1 port the driver connects to; the tunnel forwards it to the DB via the jump host. */
  localPort: number;
  /** The jump host's key fingerprint (OpenSSH `SHA256:…` form). */
  fingerprint: string;
  /** True when captured for the first time (no `knownFingerprint` was supplied) — caller persists it (TOFU). */
  fingerprintIsNew: boolean;
  /** Idempotent teardown: closes the local server and the SSH client. */
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 10_000;

/** OpenSSH-style host-key fingerprint (`SHA256:<base64, no padding>`) — the form users recognize. */
function fingerprintOf(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

/**
 * Opens/closes SSH tunnels for the target-DB seam (Phase 32). Pure transport: it takes an already-decrypted
 * config and returns a handle with a local forwarded port; it holds no Prisma and no persistence. `PoolManager`
 * owns the lifecycle — it opens a tunnel before the driver's pool and closes it when the pool is evicted/reaped,
 * so the driver connects to `127.0.0.1:localPort` exactly as to a direct host (drivers stay SSH-unaware, §1).
 */
@Injectable()
export class SshTunnelService {
  private readonly logger = new Logger(SshTunnelService.name);

  async open(cfg: SshTunnelConfig): Promise<TunnelHandle> {
    const client = new Client();
    let observedFingerprint = '';

    // Establish the SSH connection, applying trust-on-first-use host-key verification.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (stage: SshFailureStage, message: string) => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new SshTunnelError(stage, message));
      };

      client
        .on('ready', () => {
          if (settled) return;
          settled = true;
          resolve();
        })
        .on('error', (err: Error & { level?: string }) => {
          // ssh2 signals auth failures with level 'client-authentication'; everything else pre-ready is
          // a reachability/handshake problem with the bastion.
          if (settled) return;
          const stage: SshFailureStage = err.level === 'client-authentication' ? 'ssh_auth' : 'ssh_connect';
          const message = stage === 'ssh_auth' ? 'SSH authentication failed' : `Could not reach the SSH host: ${err.message}`;
          fail(stage, message);
        });

      client.connect({
        host: cfg.sshHost,
        port: cfg.sshPort,
        username: cfg.sshUsername,
        readyTimeout: CONNECT_TIMEOUT_MS,
        ...(cfg.authMethod === 'key'
          ? { privateKey: cfg.secret, ...(cfg.passphrase ? { passphrase: cfg.passphrase } : {}) }
          : { password: cfg.secret }),
        // hostVerifier receives the raw host key; compute + (TOFU) verify its fingerprint.
        hostVerifier: (key: Buffer): boolean => {
          observedFingerprint = fingerprintOf(key);
          if (cfg.knownFingerprint && cfg.knownFingerprint !== observedFingerprint) {
            fail('ssh_connect', `SSH host key mismatch — expected ${cfg.knownFingerprint}, got ${observedFingerprint}`);
            return false;
          }
          return true;
        },
      });
    });

    // A local TCP server; each accepted socket is forwarded to the DB through the SSH connection.
    const server = createServer((socket: Socket) => {
      client.forwardOut('127.0.0.1', socket.remotePort ?? 0, cfg.dbHost, cfg.dbPort, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
      });
    });

    const localPort = await new Promise<number>((resolve, reject) => {
      server.on('error', (err) => reject(new SshTunnelError('ssh_forward', `Could not open the local tunnel: ${err.message}`)));
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new SshTunnelError('ssh_forward', 'Failed to bind the local tunnel port'));
      });
    });

    this.logger.log(`ssh tunnel open host=${cfg.sshHost} user=${cfg.sshUsername} localPort=${localPort}`);

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      client.end();
      this.logger.log(`ssh tunnel closed host=${cfg.sshHost} localPort=${localPort}`);
    };

    return {
      localPort,
      fingerprint: observedFingerprint,
      fingerprintIsNew: !cfg.knownFingerprint,
      close,
    };
  }
}
