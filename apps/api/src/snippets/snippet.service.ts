import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Snippet } from '@prisma/client';
import type { CreateSnippetRequest, SnippetDto, UpdateSnippetRequest } from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * App-DB-only snippets (architecture principle §1 — Prisma, never `pg`).
 * All operations are scoped by `userId`; cross-user access returns 404 rather
 * than 403 to avoid leaking that the snippet exists.
 */
@Injectable()
export class SnippetService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<SnippetDto[]> {
    const rows = await this.prisma.snippet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSnippetDto);
  }

  async create(userId: string, req: CreateSnippetRequest): Promise<SnippetDto> {
    try {
      const row = await this.prisma.snippet.create({
        data: { userId, name: req.name, body: req.body },
      });
      return toSnippetDto(row);
    } catch (error: unknown) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictException(`A snippet named "${req.name}" already exists.`);
      }
      throw error;
    }
  }

  async update(userId: string, id: string, req: UpdateSnippetRequest): Promise<SnippetDto> {
    const existing = await this.prisma.snippet.findUniqueOrThrow({ where: { id } }).catch(() => null);
    if (!existing || existing.userId !== userId) throw new NotFoundException('Snippet not found.');

    try {
      const row = await this.prisma.snippet.update({
        where: { id },
        data: { ...(req.name !== undefined && { name: req.name }), ...(req.body !== undefined && { body: req.body }) },
      });
      return toSnippetDto(row);
    } catch (error: unknown) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictException(`A snippet named "${req.name}" already exists.`);
      }
      throw error;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.snippet.findUniqueOrThrow({ where: { id } }).catch(() => null);
    if (!existing || existing.userId !== userId) throw new NotFoundException('Snippet not found.');
    await this.prisma.snippet.delete({ where: { id } });
  }
}

export function toSnippetDto(row: Snippet): SnippetDto {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
