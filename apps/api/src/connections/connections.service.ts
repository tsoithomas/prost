import { Injectable, NotFoundException } from '@nestjs/common';
import type { Connection, Prisma } from '@prisma/client';
import type { ConnectionDto, TestConnectionResult } from '@prost/shared-types';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { PgConnectionService } from '../target-db/pg-connection.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly pgConnectionService: PgConnectionService,
  ) {}

  async list(userId: string): Promise<ConnectionDto[]> {
    const connections = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return connections.map(toConnectionDto);
  }

  async create(userId: string, dto: CreateConnectionDto): Promise<ConnectionDto> {
    const connection = await this.prisma.connection.create({
      data: {
        userId,
        name: dto.name,
        host: dto.host,
        port: dto.port,
        database: dto.database,
        username: dto.username,
        sslEnabled: dto.sslEnabled,
        encryptedCredentials: this.crypto.encrypt(dto.password) as unknown as Prisma.InputJsonValue,
      },
    });
    return toConnectionDto(connection);
  }

  async update(userId: string, id: string, dto: UpdateConnectionDto): Promise<ConnectionDto> {
    await this.requireOwned(userId, id);

    const data: Prisma.ConnectionUpdateInput = {
      name: dto.name,
      host: dto.host,
      port: dto.port,
      database: dto.database,
      username: dto.username,
      sslEnabled: dto.sslEnabled,
    };
    if (dto.password) {
      data.encryptedCredentials = this.crypto.encrypt(dto.password) as unknown as Prisma.InputJsonValue;
    }

    const connection = await this.prisma.connection.update({ where: { id }, data });
    await this.pgConnectionService.evictPool(id);
    return toConnectionDto(connection);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.prisma.connection.delete({ where: { id } });
    await this.pgConnectionService.evictPool(id);
  }

  async test(userId: string, dto: TestConnectionDto): Promise<TestConnectionResult> {
    if (dto.id) {
      const existing = await this.requireOwned(userId, dto.id);
      const storedPassword = this.crypto.decrypt(existing.encryptedCredentials as unknown as EncryptedPayload);
      return this.pgConnectionService.testConnection({
        host: dto.host ?? existing.host,
        port: dto.port ?? existing.port,
        database: dto.database ?? existing.database,
        username: dto.username ?? existing.username,
        password: dto.password || storedPassword,
        sslEnabled: dto.sslEnabled ?? existing.sslEnabled,
      });
    }

    if (!dto.host || dto.port === undefined || !dto.database || !dto.username || !dto.password) {
      return {
        ok: false,
        message: 'host, port, database, username, and password are required to test a new connection',
      };
    }

    return this.pgConnectionService.testConnection({
      host: dto.host,
      port: dto.port,
      database: dto.database,
      username: dto.username,
      password: dto.password,
      sslEnabled: dto.sslEnabled ?? false,
    });
  }

  /** Throws NotFoundException if the connection doesn't exist or isn't owned by `userId`. */
  async assertOwnership(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
  }

  private async requireOwned(userId: string, id: string): Promise<Connection> {
    const connection = await this.prisma.connection.findUnique({ where: { id } });
    if (!connection || connection.userId !== userId) {
      throw new NotFoundException('Connection not found');
    }
    return connection;
  }
}

export function toConnectionDto(connection: Connection): ConnectionDto {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    sslEnabled: connection.sslEnabled,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}
