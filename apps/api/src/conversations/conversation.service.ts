import { Injectable, NotFoundException } from '@nestjs/common';
import type { Conversation } from '@prisma/client';
import type {
  ChatMessage,
  ConversationDetailDto,
  ConversationDto,
} from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIST_LIMIT = 50;
const TITLE_MAX_CHARS = 80;

/**
 * App-DB-only persistence of AI chat threads (architecture principle §1 — Prisma, never a target
 * driver; conversation text only, never target rows). All reads/mutations are scoped by `userId`;
 * another user's id → 404 (principle §3), mirroring `HistoryService`.
 */
@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, connectionId: string): Promise<ConversationDto[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { userId, connectionId },
      orderBy: { updatedAt: 'desc' },
      take: DEFAULT_LIST_LIMIT,
    });
    return rows.map(toConversationDto);
  }

  async get(userId: string, id: string): Promise<ConversationDetailDto> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row || row.userId !== userId) throw new NotFoundException('Conversation not found.');
    return {
      ...toConversationDto(row),
      messages: row.messages.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content })),
    };
  }

  /**
   * Append a completed exchange to a thread, creating the conversation when `conversationId` is
   * omitted (title derived from the first user message). Returns the conversation summary so the
   * client can adopt the new id.
   */
  async append(
    userId: string,
    connectionId: string,
    conversationId: string | undefined,
    messages: ChatMessage[],
  ): Promise<ConversationDto> {
    let convo: Conversation;
    if (conversationId) {
      const existing = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!existing || existing.userId !== userId) throw new NotFoundException('Conversation not found.');
      convo = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    } else {
      convo = await this.prisma.conversation.create({
        data: { userId, connectionId, title: deriveTitle(messages) },
      });
    }

    if (messages.length > 0) {
      await this.prisma.conversationMessage.createMany({
        data: messages.map((m) => ({ conversationId: convo.id, role: m.role, content: m.content })),
      });
    }
    return toConversationDto(convo);
  }

  async rename(userId: string, id: string, title: string): Promise<ConversationDto> {
    await this.requireOwned(userId, id);
    const row = await this.prisma.conversation.update({ where: { id }, data: { title } });
    return toConversationDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.prisma.conversation.delete({ where: { id } });
  }

  private async requireOwned(userId: string, id: string): Promise<void> {
    const row = await this.prisma.conversation.findUnique({ where: { id }, select: { userId: true } });
    if (!row || row.userId !== userId) throw new NotFoundException('Conversation not found.');
  }
}

function toConversationDto(row: Conversation): ConversationDto {
  return {
    id: row.id,
    connectionId: row.connectionId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content.trim() ?? 'New conversation';
  const oneLine = firstUser.replace(/\s+/g, ' ');
  return oneLine.length > TITLE_MAX_CHARS ? `${oneLine.slice(0, TITLE_MAX_CHARS - 1)}…` : oneLine;
}
