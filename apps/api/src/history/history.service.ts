import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QueryHistory } from '@prisma/client';
import type { HistoryExportEntry, HistoryQuery, QueryHistoryDto, UpdateHistoryRequest } from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** The connection name is carried via a narrow relation include, never the whole connection row. */
type HistoryWithConnection = QueryHistory & { connection: { name: string } };
const WITH_CONNECTION = { connection: { select: { name: true } } } as const;

/**
 * App-DB-only history of executed queries (architecture principle §1 — Prisma, never a target
 * driver; SQL text + metadata only, never rows/values). Recording is a side effect of
 * `QueryModule`'s execute path, never a gate: write failures are logged and never propagate
 * (principle §12). All read/mutate operations are scoped by `userId`; another user's id → 404
 * (principle §3). A retention sweep prunes old, non-starred entries (principle §8/§12).
 */
@Injectable()
export class HistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistoryService.name);
  private readonly retentionDays: number;
  private readonly sweepIntervalMs: number;
  private sweepInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.retentionDays = Number(config.get('HISTORY_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS);
    this.sweepIntervalMs = Number(config.get('HISTORY_SWEEP_INTERVAL_MS') ?? DEFAULT_SWEEP_INTERVAL_MS);
  }

  async onModuleInit(): Promise<void> {
    if (this.retentionDays > 0) {
      await this.sweep();
      this.sweepInterval = setInterval(() => void this.sweep(), this.sweepIntervalMs);
    }
  }

  onModuleDestroy(): void {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
  }

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
      include: WITH_CONNECTION,
    });

    return collapseConsecutiveDuplicates(entries).map(toQueryHistoryDto);
  }

  /** Bounded, server-side search over SQL text + label, optionally narrowed to one connection. */
  async search(userId: string, query: HistoryQuery): Promise<QueryHistoryDto[]> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const search = query.search?.trim();
    const entries = await this.prisma.queryHistory.findMany({
      where: {
        userId,
        ...(query.connectionId ? { connectionId: query.connectionId } : {}),
        ...(search ? { OR: [{ sql: { contains: search } }, { label: { contains: search } }] } : {}),
      },
      orderBy: { executedAt: 'desc' },
      take,
      include: WITH_CONNECTION,
    });

    return collapseConsecutiveDuplicates(entries).map(toQueryHistoryDto);
  }

  async update(userId: string, id: string, req: UpdateHistoryRequest): Promise<QueryHistoryDto> {
    await this.requireOwned(userId, id);
    const updated = await this.prisma.queryHistory.update({
      where: { id },
      data: {
        ...(req.starred !== undefined ? { starred: req.starred } : {}),
        ...(req.label !== undefined ? { label: req.label } : {}),
      },
      include: WITH_CONNECTION,
    });
    return toQueryHistoryDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.prisma.queryHistory.delete({ where: { id } });
  }

  /** Clear non-starred entries for the user (optionally one connection); starred entries are kept. */
  async clear(userId: string, connectionId?: string): Promise<void> {
    const { count } = await this.prisma.queryHistory.deleteMany({
      where: { userId, starred: false, ...(connectionId ? { connectionId } : {}) },
    });
    this.logger.log(`history cleared userId=${userId} connectionId=${connectionId ?? 'all'} removed=${count} (starred kept)`);
  }

  /** SQL text + metadata only — never result/row data (principle §1). */
  async exportAll(userId: string): Promise<HistoryExportEntry[]> {
    const entries = await this.prisma.queryHistory.findMany({
      where: { userId },
      orderBy: { executedAt: 'desc' },
      include: WITH_CONNECTION,
    });
    return entries.map((entry) => ({
      sql: entry.sql,
      executedAt: entry.executedAt.toISOString(),
      connectionName: entry.connection.name,
      starred: entry.starred,
      ...(entry.label !== null ? { label: entry.label } : {}),
    }));
  }

  /** Periodic housekeeping: delete non-starred entries older than the retention cap. */
  private async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * DAY_MS);
    try {
      const { count } = await this.prisma.queryHistory.deleteMany({
        where: { starred: false, executedAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`history retention sweep removed=${count} olderThan=${cutoff.toISOString()} (starred exempt)`);
      }
    } catch (error) {
      this.logger.error('history retention sweep failed', error);
    }
  }

  private async requireOwned(userId: string, id: string): Promise<void> {
    const entry = await this.prisma.queryHistory.findUnique({ where: { id }, select: { userId: true } });
    if (!entry || entry.userId !== userId) {
      throw new NotFoundException('History entry not found.');
    }
  }
}

/** Re-running the same query repeatedly shouldn't dominate the recent list with copies. */
function collapseConsecutiveDuplicates(entries: HistoryWithConnection[]): HistoryWithConnection[] {
  return entries.filter((entry, index) => index === 0 || entry.sql !== entries[index - 1]!.sql);
}

export function toQueryHistoryDto(entry: HistoryWithConnection): QueryHistoryDto {
  return {
    id: entry.id,
    connectionId: entry.connectionId,
    connectionName: entry.connection.name,
    sql: entry.sql,
    executedAt: entry.executedAt.toISOString(),
    starred: entry.starred,
    ...(entry.label !== null ? { label: entry.label } : {}),
  };
}
