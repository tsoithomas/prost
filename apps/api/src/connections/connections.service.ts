import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Connection, Prisma } from '@prisma/client';
import type { ConnectionCapabilities, ConnectionDto, DbEngine, TestConnectionResult } from '@prost/shared-types';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { PoolManager } from '../database/pool-manager.service';
import { DbDriverRegistry } from '../database/db-driver.registry';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { buildSystemConnectionDto, isSystemConnectionId } from './system-connection';

const SYSTEM_CONNECTION_READONLY_MESSAGE = 'The app database connection is read-only and permanent';

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

  /** Capabilities for a stored (user-owned, writable) connection — derived from its engine's driver. */
  private toDto(connection: Connection): ConnectionDto {
    return toConnectionDto(connection, this.capabilitiesFor(connection.engine, false));
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
        engine: dto.engine ?? 'postgres',
        encryptedCredentials: this.crypto.encrypt(dto.password) as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toDto(connection);
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
    };
    if (dto.password) {
      data.encryptedCredentials = this.crypto.encrypt(dto.password) as unknown as Prisma.InputJsonValue;
    }

    const connection = await this.prisma.connection.update({ where: { id }, data });
    await this.poolManager.evictPool(id);
    return this.toDto(connection);
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
      return this.poolManager.testConnection(existing.engine ?? 'postgres', {
        host: dto.host ?? existing.host,
        port: dto.port ?? existing.port,
        database: dto.database ?? existing.database,
        username: dto.username ?? existing.username,
        password: dto.password || storedPassword,
        sslEnabled: dto.sslEnabled ?? existing.sslEnabled,
        sslRejectUnauthorized: dto.sslRejectUnauthorized ?? existing.sslRejectUnauthorized,
      });
    }

    if (!dto.host || dto.port === undefined || !dto.database || !dto.username || !dto.password) {
      return {
        ok: false,
        message: 'host, port, database, username, and password are required to test a new connection',
      };
    }

    this.assertSupportedEngine(dto.engine ?? 'postgres');
    return this.poolManager.testConnection(dto.engine ?? 'postgres', {
      host: dto.host,
      port: dto.port,
      database: dto.database,
      username: dto.username,
      password: dto.password,
      sslEnabled: dto.sslEnabled ?? false,
      sslRejectUnauthorized: dto.sslRejectUnauthorized ?? true,
    });
  }

  /**
   * Throws NotFoundException if the connection doesn't exist or isn't owned by `userId`. The virtual
   * app-DB self-connection is readable by any authenticated user (it has no owner row).
   */
  async assertOwnership(userId: string, id: string): Promise<void> {
    if (isSystemConnectionId(id)) return;
    await this.requireOwned(userId, id);
  }

  /** Whether a connection is read-only — true for the app-DB self-connection. */
  async isReadOnly(id: string): Promise<boolean> {
    return isSystemConnectionId(id);
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
    capabilities,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}
