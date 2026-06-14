import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { LlmEndpoint } from '@prisma/client';
import type { CryptoService, EncryptedPayload } from '../common/crypto.service';
import type { PrismaService } from '../prisma/prisma.service';
import { LlmEndpointService, toLlmEndpointDto } from './llm-endpoint.service';

const ENC: EncryptedPayload = { iv: 'iv', tag: 'tag', data: 'data' };

function buildRow(overrides: Partial<LlmEndpoint> = {}): LlmEndpoint {
  return {
    id: 'ep-1',
    userId: 'user-1',
    name: 'My OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    encryptedApiKey: ENC as unknown as LlmEndpoint['encryptedApiKey'],
    models: ['gpt-4o', 'gpt-4o-mini'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(overrides: Partial<Record<keyof PrismaService['llmEndpoint'], unknown>> = {}) {
  const llmEndpoint = {
    findMany: vi.fn().mockResolvedValue([buildRow()]),
    findUnique: vi.fn().mockResolvedValue(buildRow()),
    create: vi.fn().mockResolvedValue(buildRow()),
    update: vi.fn().mockResolvedValue(buildRow()),
    delete: vi.fn().mockResolvedValue(buildRow()),
    ...overrides,
  };
  const prisma = { llmEndpoint } as unknown as PrismaService;
  const crypto = {
    encrypt: vi.fn().mockReturnValue(ENC),
    decrypt: vi.fn().mockReturnValue('sk-secret'),
  } as unknown as CryptoService;
  return { service: new LlmEndpointService(prisma, crypto), prisma, crypto, llmEndpoint };
}

describe('toLlmEndpointDto', () => {
  it('maps a row to a DTO without the key', () => {
    const dto = toLlmEndpointDto(buildRow());
    expect(dto).toEqual({
      id: 'ep-1',
      name: 'My OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini'],
      hasApiKey: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('never serializes the encrypted key or userId', () => {
    const dto = toLlmEndpointDto(buildRow()) as unknown as Record<string, unknown>;
    expect(dto).not.toHaveProperty('encryptedApiKey');
    expect(dto).not.toHaveProperty('apiKey');
    expect(dto).not.toHaveProperty('userId');
    expect(JSON.stringify(dto)).not.toContain('data');
  });
});

describe('LlmEndpointService', () => {
  describe('create', () => {
    it('encrypts the api key before storing', async () => {
      const { service, crypto, llmEndpoint } = createService();
      await service.create('user-1', {
        name: 'My OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-secret',
        models: ['gpt-4o'],
      });
      expect(crypto.encrypt).toHaveBeenCalledWith('sk-secret');
      const data = (llmEndpoint.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
      expect(data.encryptedApiKey).toEqual(ENC);
      expect(data).not.toHaveProperty('apiKey');
    });

    it('returns a DTO with hasApiKey true and no raw key', async () => {
      const { service } = createService();
      const dto = (await service.create('user-1', {
        name: 'x',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk',
        models: ['gpt-4o'],
      })) as unknown as Record<string, unknown>;
      expect(dto.hasApiKey).toBe(true);
      expect(dto).not.toHaveProperty('apiKey');
    });
  });

  describe('update', () => {
    it('re-encrypts when apiKey is provided', async () => {
      const { service, crypto, llmEndpoint } = createService();
      await service.update('user-1', 'ep-1', { apiKey: 'sk-new' });
      expect(crypto.encrypt).toHaveBeenCalledWith('sk-new');
      const data = (llmEndpoint.update as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
      expect(data.encryptedApiKey).toEqual(ENC);
    });

    it('keeps the stored key when apiKey is omitted', async () => {
      const { service, crypto, llmEndpoint } = createService();
      await service.update('user-1', 'ep-1', { name: 'Renamed' });
      expect(crypto.encrypt).not.toHaveBeenCalled();
      const data = (llmEndpoint.update as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
      expect(data).not.toHaveProperty('encryptedApiKey');
      expect(data.name).toBe('Renamed');
    });

    it('throws NotFoundException for another user', async () => {
      const { service } = createService({ findUnique: vi.fn().mockResolvedValue(buildRow({ userId: 'other' })) });
      await expect(service.update('user-1', 'ep-1', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when missing', async () => {
      const { service, llmEndpoint } = createService({ findUnique: vi.fn().mockResolvedValue(null) });
      await expect(service.remove('user-1', 'ep-1')).rejects.toThrow(NotFoundException);
      expect(llmEndpoint.delete).not.toHaveBeenCalled();
    });

    it('deletes an owned endpoint', async () => {
      const { service, llmEndpoint } = createService();
      await service.remove('user-1', 'ep-1');
      expect(llmEndpoint.delete).toHaveBeenCalledWith({ where: { id: 'ep-1' } });
    });
  });

  describe('getDecrypted', () => {
    it('returns the decrypted key and config', async () => {
      const { service, crypto } = createService();
      const result = await service.getDecrypted('user-1', 'ep-1');
      expect(crypto.decrypt).toHaveBeenCalledWith(ENC);
      expect(result).toEqual({
        name: 'My OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-secret',
        models: ['gpt-4o', 'gpt-4o-mini'],
      });
    });

    it('throws NotFoundException for another user', async () => {
      const { service } = createService({ findUnique: vi.fn().mockResolvedValue(buildRow({ userId: 'other' })) });
      await expect(service.getDecrypted('user-1', 'ep-1')).rejects.toThrow(NotFoundException);
    });
  });
});
