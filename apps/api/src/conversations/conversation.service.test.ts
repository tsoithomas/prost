import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from './conversation.service';

const ROW = {
  id: 'c-1',
  userId: 'user-1',
  connectionId: 'conn-1',
  title: 'List the tables',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

function createService(overrides: Record<string, unknown> = {}) {
  const conversation = {
    findMany: vi.fn().mockResolvedValue([ROW]),
    findUnique: vi.fn().mockResolvedValue({ ...ROW, messages: [] }),
    create: vi.fn().mockResolvedValue(ROW),
    update: vi.fn().mockResolvedValue(ROW),
    delete: vi.fn().mockResolvedValue(ROW),
    ...overrides,
  };
  const conversationMessage = { createMany: vi.fn().mockResolvedValue({ count: 2 }) };
  const prisma = { conversation, conversationMessage } as unknown as PrismaService;
  return { service: new ConversationService(prisma), conversation, conversationMessage };
}

const EXCHANGE = [
  { role: 'user' as const, content: 'List the tables' },
  { role: 'assistant' as const, content: 'Here they are.' },
];

describe('ConversationService', () => {
  it('creates a conversation (title from first user message) when no id is given', async () => {
    const { service, conversation, conversationMessage } = createService();
    const dto = await service.append('user-1', 'conn-1', undefined, EXCHANGE);
    expect(conversation.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', connectionId: 'conn-1', title: 'List the tables' },
    });
    expect(conversationMessage.createMany).toHaveBeenCalled();
    expect(dto.id).toBe('c-1');
  });

  it('appends to an existing owned conversation', async () => {
    const { service, conversation } = createService();
    await service.append('user-1', 'conn-1', 'c-1', EXCHANGE);
    expect(conversation.update).toHaveBeenCalled();
    expect(conversation.create).not.toHaveBeenCalled();
  });

  it('rejects appending to another user conversation', async () => {
    const { service } = createService({
      findUnique: vi.fn().mockResolvedValue({ ...ROW, userId: 'other' }),
    });
    await expect(service.append('user-1', 'conn-1', 'c-1', EXCHANGE)).rejects.toThrow(NotFoundException);
  });

  it('get returns messages for an owned conversation', async () => {
    const { service } = createService({
      findUnique: vi.fn().mockResolvedValue({
        ...ROW,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const detail = await service.get('user-1', 'c-1');
    expect(detail.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('get 404s for another user', async () => {
    const { service } = createService({
      findUnique: vi.fn().mockResolvedValue({ ...ROW, userId: 'other', messages: [] }),
    });
    await expect(service.get('user-1', 'c-1')).rejects.toThrow(NotFoundException);
  });

  it('remove 404s when not owned', async () => {
    const { service, conversation } = createService({
      findUnique: vi.fn().mockResolvedValue({ userId: 'other' }),
    });
    await expect(service.remove('user-1', 'c-1')).rejects.toThrow(NotFoundException);
    expect(conversation.delete).not.toHaveBeenCalled();
  });
});
