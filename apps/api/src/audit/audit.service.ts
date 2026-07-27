import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditEntry, Prisma } from '@prisma/client';
import type {
  AuditAction,
  AuditEntryDto,
  AuditExportEntry,
  AuditListResponse,
  AuditOutcome,
  AuditQuery,
} from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_CONNECTION_ID, SYSTEM_CONNECTION_NAME } from '../connections/system-connection';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** The fixed facts of an audited action, known before it runs. */
export interface AuditRecordBase {
  userId: string;
  connectionId: string;
  action: AuditAction;
  /** Statement text — identifiers/placeholders only, never bound values or row data (principle §1). */
  sql: string;
  targetSchema?: string | null;
  targetTable?: string | null;
  correlationId?: string | null;
}

export interface AuditRecordInput extends AuditRecordBase {
  outcome: AuditOutcome;
  errorClass?: string | null;
  durationMs: number;
}

/** A safe, non-leaking error class: the driver code (SQLSTATE/errno) or the Nest exception name. */
export function errorClassOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return 'Error';
}

/**
 * App-DB-only audit trail of write + DDL actions (Phase 28). Recording is fire-and-forget: it never
 * throws, so auditing can't break the write path (principle §12). Stores SQL text + identifiers only,
 * never bound values or row data (principle §1). All reads are `userId`-scoped. A retention sweep
 * prunes old entries; pruning is app-DB housekeeping and is not itself audited.
 */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly retentionDays: number;
  private readonly sweepIntervalMs: number;
  private sweepInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.retentionDays = Number(config.get('AUDIT_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS);
    this.sweepIntervalMs = Number(config.get('AUDIT_SWEEP_INTERVAL_MS') ?? DEFAULT_SWEEP_INTERVAL_MS);
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

  async record(entry: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditEntry.create({
        data: {
          userId: entry.userId,
          connectionId: entry.connectionId,
          action: entry.action,
          targetSchema: entry.targetSchema ?? null,
          targetTable: entry.targetTable ?? null,
          sql: entry.sql,
          outcome: entry.outcome,
          errorClass: entry.errorClass ?? null,
          durationMs: entry.durationMs,
          correlationId: entry.correlationId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record audit entry for connection ${entry.connectionId}`, error as Error);
    }
  }

  /** Times `fn`, records a success/failure audit entry around it, then returns or rethrows. */
  async withAudit<T>(base: AuditRecordBase, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      void this.record({ ...base, outcome: 'success', durationMs: Date.now() - start });
      return result;
    } catch (error) {
      void this.record({ ...base, outcome: 'failure', errorClass: errorClassOf(error), durationMs: Date.now() - start });
      throw error;
    }
  }

  async list(userId: string, query: AuditQuery): Promise<AuditListResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rows = await this.prisma.auditEntry.findMany({
      where: buildWhere(userId, query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const names = await this.connectionNameMap(userId);
    return {
      entries: page.map((row) => this.toDto(row, names)),
      ...(hasMore ? { nextCursor: page[page.length - 1]!.id } : {}),
    };
  }

  /** SQL text + metadata only (identifiers) — never bound values or row data (principle §1). */
  async exportAll(userId: string, query: AuditQuery = {}): Promise<AuditExportEntry[]> {
    const rows = await this.prisma.auditEntry.findMany({
      where: buildWhere(userId, query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const names = await this.connectionNameMap(userId);
    return rows.map((row) => {
      const dto = this.toDto(row, names);
      return {
        action: dto.action,
        connectionId: dto.connectionId,
        connectionName: dto.connectionName,
        ...(dto.targetSchema !== undefined ? { targetSchema: dto.targetSchema } : {}),
        ...(dto.targetTable !== undefined ? { targetTable: dto.targetTable } : {}),
        sql: dto.sql,
        outcome: dto.outcome,
        ...(dto.errorClass !== undefined ? { errorClass: dto.errorClass } : {}),
        durationMs: dto.durationMs,
        createdAt: dto.createdAt,
      };
    });
  }

  private async connectionNameMap(userId: string): Promise<Map<string, string>> {
    const connections = await this.prisma.connection.findMany({ where: { userId }, select: { id: true, name: true } });
    const map = new Map(connections.map((c) => [c.id, c.name]));
    map.set(SYSTEM_CONNECTION_ID, SYSTEM_CONNECTION_NAME);
    return map;
  }

  private toDto(row: AuditEntry, names: Map<string, string>): AuditEntryDto {
    return {
      id: row.id,
      connectionId: row.connectionId,
      connectionName: names.get(row.connectionId) ?? null,
      action: row.action as AuditAction,
      ...(row.targetSchema !== null ? { targetSchema: row.targetSchema } : {}),
      ...(row.targetTable !== null ? { targetTable: row.targetTable } : {}),
      sql: row.sql,
      outcome: row.outcome as AuditOutcome,
      ...(row.errorClass !== null ? { errorClass: row.errorClass } : {}),
      durationMs: row.durationMs,
      ...(row.correlationId !== null ? { correlationId: row.correlationId } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * DAY_MS);
    try {
      const { count } = await this.prisma.auditEntry.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (count > 0) {
        this.logger.log(`audit retention sweep removed=${count} olderThan=${cutoff.toISOString()}`);
      }
    } catch (error) {
      this.logger.error('audit retention sweep failed', error as Error);
    }
  }
}

function buildWhere(userId: string, query: AuditQuery): Prisma.AuditEntryWhereInput {
  return {
    userId,
    ...(query.connectionId ? { connectionId: query.connectionId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };
}
