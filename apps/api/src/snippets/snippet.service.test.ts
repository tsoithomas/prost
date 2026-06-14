import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Snippet } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { SnippetService, toSnippetDto } from './snippet.service';

function buildSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: 'snip-1',
    userId: 'user-1',
    name: 'My snippet',
    body: 'SELECT * FROM users',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(overrides: {
  findMany?: ReturnType<typeof vi.fn>;
  findUniqueOrThrow?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
} = {}) {
  const snippet = {
    findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
    findUniqueOrThrow: overrides.findUniqueOrThrow ?? vi.fn().mockResolvedValue(buildSnippet()),
    create: overrides.create ?? vi.fn().mockResolvedValue(buildSnippet()),
    update: overrides.update ?? vi.fn().mockResolvedValue(buildSnippet()),
    delete: overrides.delete ?? vi.fn().mockResolvedValue(undefined),
  };
  const prisma = { snippet } as unknown as PrismaService;
  return { service: new SnippetService(prisma), snippet };
}

describe('toSnippetDto', () => {
  it('maps a Snippet row to a SnippetDto without exposing userId', () => {
    const dto = toSnippetDto(buildSnippet());
    expect(dto).toEqual({
      id: 'snip-1',
      name: 'My snippet',
      body: 'SELECT * FROM users',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(dto).not.toHaveProperty('userId');
  });
});

describe('SnippetService.list', () => {
  it('queries by userId only, ordered newest first', async () => {
    const { service, snippet } = createService();
    await service.list('user-1');
    expect(snippet.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it("does not return another user's snippets", async () => {
    const ownSnippet = buildSnippet({ id: 'snip-own', userId: 'user-1' });
    const { service } = createService({
      findMany: vi.fn().mockResolvedValue([ownSnippet]),
    });
    const result = await service.list('user-1');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('snip-own');
  });
});

describe('SnippetService.create', () => {
  it('creates a snippet and returns its SnippetDto', async () => {
    const { service, snippet } = createService();
    const result = await service.create('user-1', { name: 'My snippet', body: 'SELECT 1' });
    expect(snippet.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'My snippet', body: 'SELECT 1' },
    });
    expect(result.name).toBe('My snippet');
  });

  it('throws ConflictException on duplicate name (Prisma P2002)', async () => {
    const { service } = createService({
      create: vi.fn().mockRejectedValue({ code: 'P2002' }),
    });
    await expect(service.create('user-1', { name: 'dupe', body: 'SELECT 1' })).rejects.toThrow(ConflictException);
  });
});

describe('SnippetService.update', () => {
  it('updates the snippet and returns updated SnippetDto', async () => {
    const updated = buildSnippet({ name: 'Renamed' });
    const { service, snippet } = createService({
      findUniqueOrThrow: vi.fn().mockResolvedValue(buildSnippet({ userId: 'user-1' })),
      update: vi.fn().mockResolvedValue(updated),
    });
    const result = await service.update('user-1', 'snip-1', { name: 'Renamed' });
    expect(snippet.update).toHaveBeenCalled();
    expect(result.name).toBe('Renamed');
  });

  it('throws NotFoundException when the snippet belongs to another user', async () => {
    const { service } = createService({
      findUniqueOrThrow: vi.fn().mockResolvedValue(buildSnippet({ userId: 'user-other' })),
    });
    await expect(service.update('user-1', 'snip-1', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when snippet does not exist', async () => {
    const { service } = createService({
      findUniqueOrThrow: vi.fn().mockRejectedValue(new Error('not found')),
    });
    await expect(service.update('user-1', 'missing', { name: 'x' })).rejects.toThrow(NotFoundException);
  });
});

describe('SnippetService.remove', () => {
  it('deletes the snippet when ownership is confirmed', async () => {
    const { service, snippet } = createService({
      findUniqueOrThrow: vi.fn().mockResolvedValue(buildSnippet({ userId: 'user-1' })),
    });
    await service.remove('user-1', 'snip-1');
    expect(snippet.delete).toHaveBeenCalledWith({ where: { id: 'snip-1' } });
  });

  it('throws NotFoundException when the snippet belongs to another user', async () => {
    const { service } = createService({
      findUniqueOrThrow: vi.fn().mockResolvedValue(buildSnippet({ userId: 'user-other' })),
    });
    await expect(service.remove('user-1', 'snip-1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when snippet does not exist', async () => {
    const { service } = createService({
      findUniqueOrThrow: vi.fn().mockRejectedValue(new Error('not found')),
    });
    await expect(service.remove('user-1', 'missing')).rejects.toThrow(NotFoundException);
  });
});
