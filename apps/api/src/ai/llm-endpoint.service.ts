import { Injectable, NotFoundException } from '@nestjs/common';
import type { LlmEndpoint, Prisma } from '@prisma/client';
import type { LlmEndpointDto, LlmProbeResult } from '@prost/shared-types';
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
  contextBudget: number | null;
  maxOutputTokens: number | null;
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
        contextBudget: dto.contextBudget ?? null,
        maxOutputTokens: dto.maxOutputTokens ?? null,
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
    if (dto.contextBudget !== undefined) data.contextBudget = dto.contextBudget;
    if (dto.maxOutputTokens !== undefined) data.maxOutputTokens = dto.maxOutputTokens;
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
      contextBudget: row.contextBudget,
      maxOutputTokens: row.maxOutputTokens,
    };
  }

  /**
   * Best-effort discovery: fetch `{baseUrl}/v1/models` to list available model IDs and, when the
   * endpoint reports one, a context length (OpenRouter/vLLM expose `context_length`/`max_model_len`;
   * most omit it). Used to prefill the endpoints modal — never authoritative. Never throws for a
   * bad endpoint; returns empty results the caller can fall back from.
   */
  async probe(baseUrl: string, apiKey: string): Promise<LlmProbeResult> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    try {
      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return { models: [], contextLength: null };
      const body = (await res.json()) as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data : [];
      const models = rows
        .map((r) => (r as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string')
        .sort();
      let contextLength: number | null = null;
      for (const r of rows) {
        const row = r as { context_length?: unknown; max_model_len?: unknown };
        const len = typeof row.context_length === 'number' ? row.context_length
          : typeof row.max_model_len === 'number' ? row.max_model_len : null;
        if (len != null) contextLength = Math.max(contextLength ?? 0, len);
      }
      return { models, contextLength };
    } catch {
      return { models: [], contextLength: null };
    }
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
    contextBudget: row.contextBudget,
    maxOutputTokens: row.maxOutputTokens,
    createdAt: row.createdAt.toISOString(),
  };
}
