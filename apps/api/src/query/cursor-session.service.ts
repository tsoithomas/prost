import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ColumnMetadata, FetchCursorResponse, OpenCursorResponse } from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import type { DriverCursor } from '../database/types';
import { QueryService } from './query.service';
import { QUERY_PAGE_SIZE } from './paging';

interface CursorSession {
  connectionId: string;
  userId: string;
  cursor: DriverCursor;
  /** Rows served so far — the next forward block starts here, and the basis for the row budget. */
  position: number;
  lastUsed: number;
}

/**
 * Owns the lifecycle of forward-only streaming cursors for the SQL editor (architecture
 * principles §7/§12). Each session pins a server-side cursor on a pooled client (via `PoolManager`)
 * and is addressed by an opaque `sessionId` across HTTP requests. Sessions are bounded (global +
 * per-connection caps), budget-limited (`STREAM_MAX_ROWS`), and reaped when idle so an abandoned
 * stream never holds a client forever. No cursor state touches the app DB — this map is in-memory.
 */
@Injectable()
export class CursorSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CursorSessionService.name);
  private readonly sessions = new Map<string, CursorSession>();
  private reapInterval?: ReturnType<typeof setInterval>;

  private readonly idleMs: number;
  private readonly maxRows: number;
  private readonly maxSessions: number;
  private readonly maxPerConnection: number;

  constructor(
    private readonly pool: PoolManager,
    private readonly queryService: QueryService,
    config: ConfigService,
  ) {
    this.idleMs = Number(config.get('STREAM_CURSOR_IDLE_MS') ?? 60_000);
    this.maxRows = Number(config.get('STREAM_MAX_ROWS') ?? 100_000);
    this.maxSessions = Number(config.get('STREAM_MAX_SESSIONS') ?? 50);
    // Kept below the per-connection pool client cap (TARGET_POOL_SIZE, default 5) so streamed
    // reads can never starve writes of a client.
    this.maxPerConnection = Number(config.get('STREAM_MAX_CURSORS_PER_CONNECTION') ?? 3);
  }

  onModuleInit(): void {
    this.reapInterval = setInterval(() => this.reap(), Math.max(1_000, Math.floor(this.idleMs / 2)));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reapInterval) clearInterval(this.reapInterval);
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)));
  }

  /**
   * Open a cursor for a single SELECT, fetch the first block, and (unless it already completed)
   * register the session for subsequent fetches. Validation, editability, and column metadata are
   * resolved exactly as the offset execute path does, so the grid renders identically.
   */
  async open(connectionId: string, userId: string, sql: string, correlationId = ''): Promise<OpenCursorResponse> {
    const statementText = await this.queryService.resolveSingleSelect(connectionId, sql);
    const driver = await this.pool.driverFor(connectionId);
    if (!driver.capabilities.supportsCursors) {
      throw new BadRequestException('Streaming is not supported for this engine');
    }
    this.assertCapacity(connectionId);

    const cursor = await this.pool.openCursor(connectionId, { sql: statementText, params: [] });
    let first: { rows: Record<string, unknown>[]; complete: boolean };
    try {
      first = await cursor.fetch(QUERY_PAGE_SIZE);
    } catch (error) {
      await cursor.close().catch(() => undefined);
      throw error;
    }

    const editability = await this.queryService.analyzeSelectEditability(connectionId, statementText);
    const columns: ColumnMetadata[] = await this.queryService.describeColumns(
      connectionId,
      cursor.columns(),
      editability.primaryKey,
    );

    // A first block big enough to blow the budget is closed immediately (blockSize « budget, so rare).
    const truncated = !first.complete && first.rows.length >= this.maxRows;
    const ended = first.complete || truncated;

    const sessionId = randomUUID();
    if (ended) {
      await cursor.close().catch(() => undefined);
    } else {
      this.sessions.set(sessionId, {
        connectionId,
        userId,
        cursor,
        position: first.rows.length,
        lastUsed: Date.now(),
      });
    }
    this.logger.log(
      `cursor session open connectionId=${connectionId} sessionId=${sessionId} rows=${first.rows.length} ended=${ended} correlationId=${correlationId}`,
    );

    return {
      sessionId,
      rows: first.rows,
      columns,
      totalRows: first.rows.length,
      complete: ended,
      truncated: truncated || undefined,
      ...editability,
    };
  }

  /** Pull the next forward block for a session, enforcing the row budget and closing on end/budget. */
  async fetch(
    connectionId: string,
    userId: string,
    sessionId: string,
    limit = QUERY_PAGE_SIZE,
    correlationId = '',
  ): Promise<FetchCursorResponse> {
    const session = this.requireSession(connectionId, userId, sessionId);
    session.lastUsed = Date.now();

    const remaining = this.maxRows - session.position;
    if (remaining <= 0) {
      await this.closeSession(sessionId);
      return { rows: [], complete: true, truncated: true, executionTimeMs: 0 };
    }

    const blockSize = Math.min(limit, remaining);
    const start = Date.now();
    const { rows, complete } = await session.cursor.fetch(blockSize);
    session.position += rows.length;
    const executionTimeMs = Date.now() - start;

    const hitBudget = !complete && session.position >= this.maxRows;
    if (complete || hitBudget) {
      await this.closeSession(sessionId);
      this.logger.log(
        `cursor session end connectionId=${connectionId} sessionId=${sessionId} served=${session.position} budget=${hitBudget} correlationId=${correlationId}`,
      );
    }

    return { rows, complete: complete || hitBudget, truncated: hitBudget || undefined, executionTimeMs };
  }

  /** Explicit teardown (new run / navigate away). Idempotent — closing an unknown session is a no-op. */
  async close(connectionId: string, userId: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.connectionId !== connectionId || session.userId !== userId) {
      throw new NotFoundException('Cursor session not found');
    }
    await this.closeSession(sessionId);
  }

  private requireSession(connectionId: string, userId: string, sessionId: string): CursorSession {
    const session = this.sessions.get(sessionId);
    // A reaped/expired/foreign session reads as "not found" so the client restarts cleanly (principle §11).
    if (!session || session.connectionId !== connectionId || session.userId !== userId) {
      throw new NotFoundException('Cursor session not found or expired');
    }
    return session;
  }

  private assertCapacity(connectionId: string): void {
    if (this.sessions.size >= this.maxSessions) {
      throw new ServiceUnavailableException('Too many active streaming sessions; try again shortly');
    }
    let perConnection = 0;
    for (const session of this.sessions.values()) {
      if (session.connectionId === connectionId) perConnection += 1;
    }
    if (perConnection >= this.maxPerConnection) {
      throw new ServiceUnavailableException('Too many active streams on this connection; close one and retry');
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.cursor.close().catch((error) => {
      this.logger.warn(`cursor close failed sessionId=${sessionId} error=${error instanceof Error ? error.message : 'unknown'}`);
    });
  }

  private reap(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastUsed > this.idleMs) {
        this.logger.log(`cursor session reaped sessionId=${sessionId} idleMs=${now - session.lastUsed}`);
        void this.closeSession(sessionId);
      }
    }
  }
}
