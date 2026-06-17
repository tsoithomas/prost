import { Injectable, NotFoundException } from '@nestjs/common';
import type { LlmEndpoint, Prisma } from '@prisma/client';
import type { LlmEndpointDto } from '@prost/shared-types';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLlmEndpointDto } from './dto/create-llm-endpoint.dto';
import { UpdateLlmEndpointDto } from './dto/update-llm-endpoint.dto';

/** A decrypted endpoint config — service-internal, consumed only by AiService, never serialized. */
export interface DecryptedEndpoint {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

/** `models` is stored as a JSON-encoded string array (SQLite has no scalar-list type). */
function serializeModels(models: string[]): string {
  return JSON.stringify(models);
}

function parseModels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

@Injectable()
export class LlmEndpointService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async list(userId: string): Promise<LlmEndpointDto[]> {
    const rows = await this.prisma.llmEndpoint.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toLlmEndpointDto);
  }

  async create(userId: string, dto: CreateLlmEndpointDto): Promise<LlmEndpointDto> {
    const row = await this.prisma.llmEndpoint.create({
      data: {
        userId,
        name: dto.name,
        baseUrl: dto.baseUrl,
        models: serializeModels(dto.models),
        encryptedApiKey: this.crypto.encrypt(dto.apiKey) as unknown as Prisma.InputJsonValue,
      },
    });
    return toLlmEndpointDto(row);
  }

  async update(userId: string, id: string, dto: UpdateLlmEndpointDto): Promise<LlmEndpointDto> {
    await this.requireOwned(userId, id);
    const data: Prisma.LlmEndpointUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl;
    if (dto.models !== undefined) data.models = serializeModels(dto.models);
    if (dto.apiKey !== undefined) {
      data.encryptedApiKey = this.crypto.encrypt(dto.apiKey) as unknown as Prisma.InputJsonValue;
    }
    const row = await this.prisma.llmEndpoint.update({ where: { id }, data });
    return toLlmEndpointDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.prisma.llmEndpoint.delete({ where: { id } });
  }

  /** Returns the decrypted endpoint for server-side provider calls. Never exposed over HTTP. */
  async getDecrypted(userId: string, id: string): Promise<DecryptedEndpoint> {
    const row = await this.requireOwned(userId, id);
    return {
      name: row.name,
      baseUrl: row.baseUrl,
      apiKey: this.crypto.decrypt(row.encryptedApiKey as unknown as EncryptedPayload),
      models: parseModels(row.models),
    };
  }

  private async requireOwned(userId: string, id: string): Promise<LlmEndpoint> {
    const row = await this.prisma.llmEndpoint.findUnique({ where: { id } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('LLM endpoint not found');
    }
    return row;
  }
}

export function toLlmEndpointDto(row: LlmEndpoint): LlmEndpointDto {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    models: parseModels(row.models),
    hasApiKey: true,
    createdAt: row.createdAt.toISOString(),
  };
}
