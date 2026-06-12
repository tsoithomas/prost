import { Injectable, Logger } from '@nestjs/common';
import type { QueryHistory } from '@prisma/client';
import type { QueryHistoryDto } from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIMIT = 50;

/**
 * App-DB-only history of executed queries (architecture principle §1 — Prisma, never `pg`).
 * Recording is a side effect of `QueryModule`'s execute path, never a gate: write failures are
 * logged here and never propagate (principle §12).
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: { userId: string; connectionId: string; sql: string }): Promise<void> {
    try {
      await this.prisma.queryHistory.create({ data: entry });
    } catch (error) {
      this.logger.error(`Failed to record query history for connection ${entry.connectionId}`, error);
    }
  }

  async listRecent(userId: string, connectionId: string, limit = DEFAULT_LIMIT): Promise<QueryHistoryDto[]> {
    const entries = await this.prisma.queryHistory.findMany({
      where: { userId, connectionId },
      orderBy: { executedAt: 'desc' },
      take: limit,
    });

    return collapseConsecutiveDuplicates(entries).map(toQueryHistoryDto);
  }
}

/** Re-running the same query repeatedly shouldn't dominate the recent list with copies. */
function collapseConsecutiveDuplicates(entries: QueryHistory[]): QueryHistory[] {
  return entries.filter((entry, index) => index === 0 || entry.sql !== entries[index - 1]!.sql);
}

export function toQueryHistoryDto(entry: QueryHistory): QueryHistoryDto {
  return {
    id: entry.id,
    connectionId: entry.connectionId,
    sql: entry.sql,
    executedAt: entry.executedAt.toISOString(),
  };
}
