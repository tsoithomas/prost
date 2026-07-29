import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Connection, Prisma } from '@prisma/client';
import type { ConnectionCapabilities, ConnectionDto, ConnectionEnvironment, DbEngine, SshAuthMethod, TestConnectionResult } from '@prost/shared-types';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { PoolManager } from '../database/pool-manager.service';
import type { SshEndpointConfig } from '../database/ssh-tunnel.service';
import { DbDriverRegistry } from '../database/db-driver.registry';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { buildSystemConnectionDto, isSystemConnectionId } from './system-connection';

const SYSTEM_CONNECTION_READONLY_MESSAGE = 'The app database connection is read-only and permanent';

/** The SSH columns written on create (Phase 32) — a narrow slice of the Prisma create input. */
type SshWriteData = Pick<
  Prisma.ConnectionUncheckedCreateInput,
  'sshEnabled' | 'sshHost' | 'sshPort' | 'sshUsername' | 'sshAuthMethod' | 'encryptedSshSecret' | 'sshKeyPassphraseEncrypted'
>;

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly poolManager: PoolManager,
    private readonly registry: DbDriverRegistry,
    private readonly config: ConfigService,
  ) {}

  async list(userId: string): Promise<ConnectionDto[]> {
    const connections = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    // The virtual app-DB self-connection is prepended for every user.
    return [
      buildSystemConnectionDto(this.config.getOrThrow('DATABASE_URL')),
      ...connections.map((c) => this.toDto(c)),
    ];
  }

  /** Capabilities for a stored connection — schema support from the driver, read-only from its own flag. */
  private toDto(connection: Connection): ConnectionDto {
    return toConnectionDto(connection, this.capabilitiesFor(connection.engine, connection.readOnly));
  }

  private capabilitiesFor(engine: string, readOnly: boolean): ConnectionCapabilities {
    let hasSchemas = true;
    try {
      hasSchemas = this.registry.get(engine).capabilities.supportsSchemas;
    } catch {
      hasSchemas = true;
    }
    return { hasSchemas, readOnly };
  }

  /** Reject engines no registered driver supports — defers to the registry so new engines
   *  become valid purely by registration. */
  private assertSupportedEngine(engine: string): void {
    this.registry.get(engine);
  }

  async create(userId: string, dto: CreateConnectionDto): Promise<ConnectionDto> {
    this.assertSupportedEngine(dto.engine ?? 'postgres');
    const connection = await this.prisma.connection.create({
      data: {
        userId,
        name: dto.name,
        host: dto.host,
        port: dto.port,
        database: dto.database,
        username: dto.username,
        sslEnabled: dto.sslEnabled,
        sslRejectUnauthorized: dto.sslRejectUnauthorized,
        environment: dto.environment,
        readOnly: dto.readOnly,
        engine: dto.engine ?? 'postgres',
        encryptedCredentials: this.crypto.encrypt(dto.password) as unknown as Prisma.InputJsonValue,
        ...this.sshCreateData(dto),
      },
    });
    return this.toDto(connection);
  }

  /** Builds the SSH columns for a create, encrypting the secret + optional passphrase (Phase 32). */
  private sshCreateData(dto: CreateConnectionDto): SshWriteData {
    if (!dto.sshEnabled) return { sshEnabled: false };
    return {
      sshEnabled: true,
      sshHost: dto.sshHost ?? null,
      sshPort: dto.sshPort ?? 22,
      sshUsername: dto.sshUsername ?? null,
      sshAuthMethod: dto.sshAuthMethod ?? 'key',
      ...(dto.sshSecret ? { encryptedSshSecret: this.crypto.encrypt(dto.sshSecret) as unknown as Prisma.InputJsonValue } : {}),
      ...(dto.sshKeyPassphrase
        ? { sshKeyPassphraseEncrypted: this.crypto.encrypt(dto.sshKeyPassphrase) as unknown as Prisma.InputJsonValue }
        : {}),
    };
  }

  async update(userId: string, id: string, dto: UpdateConnectionDto): Promise<ConnectionDto> {
    this.assertNotSystem(id);
    await this.requireOwned(userId, id);

    const data: Prisma.ConnectionUpdateInput = {
      name: dto.name,
      host: dto.host,
      port: dto.port,
      database: dto.database,
      username: dto.username,
      sslEnabled: dto.sslEnabled,
      sslRejectUnauthorized: dto.sslRejectUnauthorized,
      environment: dto.environment,
      readOnly: dto.readOnly,
    };
    if (dto.password) {
      data.encryptedCredentials = this.crypto.encrypt(dto.password) as unknown as Prisma.InputJsonValue;
    }
    this.applySshUpdate(data, dto);

    const connection = await this.prisma.connection.update({ where: { id }, data });
    await this.poolManager.evictPool(id);
    return this.toDto(connection);
  }

  /**
   * Applies SSH changes to an update (Phase 32). Toggling SSH off clears the config; changing SSH host/user
   * clears the stored host-key fingerprint so TOFU re-captures on the next connect. The secret/passphrase are
   * only rewritten when supplied (blank = keep stored), mirroring the DB password.
   */
  private applySshUpdate(data: Prisma.ConnectionUpdateInput, dto: UpdateConnectionDto): void {
    if (dto.sshEnabled === undefined) return;
    if (!dto.sshEnabled) {
      data.sshEnabled = false;
      data.sshHostFingerprint = null;
      return;
    }
    data.sshEnabled = true;
    if (dto.sshHost !== undefined) { data.sshHost = dto.sshHost; data.sshHostFingerprint = null; }
    if (dto.sshPort !== undefined) data.sshPort = dto.sshPort;
    if (dto.sshUsername !== undefined) { data.sshUsername = dto.sshUsername; data.sshHostFingerprint = null; }
    if (dto.sshAuthMethod !== undefined) data.sshAuthMethod = dto.sshAuthMethod;
    if (dto.sshSecret) data.encryptedSshSecret = this.crypto.encrypt(dto.sshSecret) as unknown as Prisma.InputJsonValue;
    if (dto.sshKeyPassphrase) {
      data.sshKeyPassphraseEncrypted = this.crypto.encrypt(dto.sshKeyPassphrase) as unknown as Prisma.InputJsonValue;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    this.assertNotSystem(id);
    await this.requireOwned(userId, id);
    await this.prisma.connection.delete({ where: { id } });
    await this.poolManager.evictPool(id);
  }

  async test(userId: string, dto: TestConnectionDto): Promise<TestConnectionResult> {
    if (dto.id && isSystemConnectionId(dto.id)) {
      return { ok: true, message: 'Connection successful' };
    }
    if (dto.id) {
      const existing = await this.requireOwned(userId, dto.id);
      const storedPassword = this.crypto.decrypt(existing.encryptedCredentials as unknown as EncryptedPayload);
      return this.poolManager.testConnection(
        existing.engine ?? 'postgres',
        {
          host: dto.host ?? existing.host,
          port: dto.port ?? existing.port,
          database: dto.database ?? existing.database,
          username: dto.username ?? existing.username,
          password: dto.password || storedPassword,
          sslEnabled: dto.sslEnabled ?? existing.sslEnabled,
          sslRejectUnauthorized: dto.sslRejectUnauthorized ?? existing.sslRejectUnauthorized,
        },
        this.buildTestSshConfig(dto, existing),
      );
    }

    if (!dto.host || dto.port === undefined || !dto.database || !dto.username || !dto.password) {
      return {
        ok: false,
        message: 'host, port, database, username, and password are required to test a new connection',
      };
    }

    this.assertSupportedEngine(dto.engine ?? 'postgres');
    return this.poolManager.testConnection(
      dto.engine ?? 'postgres',
      {
        host: dto.host,
        port: dto.port,
        database: dto.database,
        username: dto.username,
        password: dto.password,
        sslEnabled: dto.sslEnabled ?? false,
        sslRejectUnauthorized: dto.sslRejectUnauthorized ?? true,
      },
      this.buildTestSshConfig(dto),
    );
  }

  /**
   * Resolves the SSH config to test with (Phase 32): the DTO's fields take precedence, falling back to the
   * stored connection when testing a saved one (a blank `sshSecret` reuses the stored secret). Returns
   * `undefined` when SSH isn't enabled. Never verifies against a stored fingerprint here — a test just
   * observes + reports the fingerprint; the real connect is what pins it (TOFU).
   */
  private buildTestSshConfig(dto: TestConnectionDto, existing?: Connection): SshEndpointConfig | undefined {
    const enabled = dto.sshEnabled ?? existing?.sshEnabled ?? false;
    if (!enabled) return undefined;

    const secret = dto.sshSecret
      ? dto.sshSecret
      : existing?.encryptedSshSecret
        ? this.crypto.decrypt(existing.encryptedSshSecret as unknown as EncryptedPayload)
        : undefined;
    if (!secret) return undefined;

    const passphrase = dto.sshKeyPassphrase
      ? dto.sshKeyPassphrase
      : existing?.sshKeyPassphraseEncrypted
        ? this.crypto.decrypt(existing.sshKeyPassphraseEncrypted as unknown as EncryptedPayload)
        : undefined;

    return {
      sshHost: dto.sshHost ?? existing?.sshHost ?? '',
      sshPort: dto.sshPort ?? existing?.sshPort ?? 22,
      sshUsername: dto.sshUsername ?? existing?.sshUsername ?? '',
      authMethod: (dto.sshAuthMethod ?? existing?.sshAuthMethod ?? 'key') === 'password' ? 'password' : 'key',
      secret,
      ...(passphrase ? { passphrase } : {}),
    };
  }

  /**
   * Throws NotFoundException if the connection doesn't exist or isn't owned by `userId`. The virtual
   * app-DB self-connection is readable by any authenticated user (it has no owner row).
   */
  async assertOwnership(userId: string, id: string): Promise<void> {
    if (isSystemConnectionId(id)) return;
    await this.requireOwned(userId, id);
  }

  /** Whether a connection is read-only — the app-DB self-connection, or a connection with its flag set (Phase 25). */
  async isReadOnly(id: string): Promise<boolean> {
    if (isSystemConnectionId(id)) return true;
    const connection = await this.prisma.connection.findUnique({ where: { id }, select: { readOnly: true } });
    return connection?.readOnly ?? false;
  }

  private assertNotSystem(id: string): void {
    if (isSystemConnectionId(id)) {
      throw new ForbiddenException(SYSTEM_CONNECTION_READONLY_MESSAGE);
    }
  }

  private async requireOwned(userId: string, id: string): Promise<Connection> {
    const connection = await this.prisma.connection.findUnique({ where: { id } });
    if (!connection || connection.userId !== userId) {
      throw new NotFoundException('Connection not found');
    }
    return connection;
  }
}

export function toConnectionDto(connection: Connection, capabilities: ConnectionCapabilities): ConnectionDto {
  return {
    id: connection.id,
    name: connection.name,
    engine: (connection.engine as DbEngine) ?? 'postgres',
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    sslEnabled: connection.sslEnabled,
    sslRejectUnauthorized: connection.sslRejectUnauthorized,
    environment: (connection.environment as ConnectionEnvironment) ?? 'dev',
    // Non-secret SSH fields only — the key/password/passphrase are never serialized (Phase 32, §3).
    ssh: {
      sshEnabled: connection.sshEnabled,
      ...(connection.sshHost ? { sshHost: connection.sshHost } : {}),
      ...(connection.sshPort != null ? { sshPort: connection.sshPort } : {}),
      ...(connection.sshUsername ? { sshUsername: connection.sshUsername } : {}),
      ...(connection.sshAuthMethod ? { sshAuthMethod: connection.sshAuthMethod as SshAuthMethod } : {}),
      ...(connection.sshHostFingerprint ? { sshHostFingerprint: connection.sshHostFingerprint } : {}),
    },
    capabilities,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}
