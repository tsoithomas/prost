import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import type { PoolManager } from '../database/pool-manager.service';
import type { DriverCursor } from '../database/types';
import { CursorSessionService } from './cursor-session.service';
import type { QueryService } from './query.service';

/** A fake forward-only cursor over `total` synthetic rows, mirroring the real driver contract. */
function makeCursor(total: number) {
  let position = 0;
  let closed = false;
  const cursor: DriverCursor & { isClosed: () => boolean } = {
    fetch: vi.fn(async (n: number) => {
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < n && position < total; i += 1) {
        rows.push({ id: position });
        position += 1;
      }
      const complete = position >= total;
      if (complete) closed = true;
      return { rows, complete };
    }),
    columns: () => [{ name: 'id', dataTypeID: 23 }],
    close: vi.fn(async () => {
      closed = true;
    }),
    isClosed: () => closed,
  };
  return cursor;
}

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'int4', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

function makeHarness(options: { cursors?: ReturnType<typeof makeCursor>[]; config?: Record<string, unknown>; supportsCursors?: boolean } = {}) {
  const cursors = options.cursors ?? [makeCursor(250)];
  let next = 0;
  const openCursor = vi.fn(async () => cursors[Math.min(next++, cursors.length - 1)]!);
  const pool = {
    driverFor: vi.fn(async () => ({ capabilities: { supportsCursors: options.supportsCursors ?? true } })),
    openCursor,
  } as unknown as PoolManager;
  const queryService = {
    resolveSingleSelect: vi.fn(async (_connectionId: string, sql: string) => sql),
    analyzeSelectEditability: vi.fn(async () => ({ editable: false as const })),
    describeColumns: vi.fn(async () => COLUMNS),
  } as unknown as QueryService;
  const config = {
    get: vi.fn((key: string) => options.config?.[key]),
  } as unknown as ConfigService;
  const service = new CursorSessionService(pool, queryService, config);
  return { service, pool, queryService, openCursor, cursors };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CursorSessionService', () => {
  it('opens a cursor, returns the first block, and registers a session for large results', async () => {
    const { service, cursors } = makeHarness();
    const result = await service.open('conn-1', 'user-1', 'SELECT * FROM big');

    expect(result.rows).toHaveLength(100);
    expect(result.complete).toBe(false);
    expect(result.truncated).toBeUndefined();
    expect(result.columns).toEqual(COLUMNS);
    expect(result.sessionId).toBeTruthy();
    expect(cursors[0]!.isClosed()).toBe(false);
  });

  it('closes the cursor immediately when the first block completes the result (small result)', async () => {
    const { service, cursors } = makeHarness({ cursors: [makeCursor(5)] });
    const result = await service.open('conn-1', 'user-1', 'SELECT * FROM small');

    expect(result.rows).toHaveLength(5);
    expect(result.complete).toBe(true);
    expect(cursors[0]!.close).toHaveBeenCalled();
    // A completed open registers no session — a follow-up fetch is "not found".
    await expect(service.fetch('conn-1', 'user-1', result.sessionId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serves sequential forward blocks and closes on completion', async () => {
    const { service, cursors } = makeHarness({ cursors: [makeCursor(250)] });
    const opened = await service.open('conn-1', 'user-1', 'SELECT * FROM big');

    const second = await service.fetch('conn-1', 'user-1', opened.sessionId, 100);
    expect(second.rows.map((r) => r.id)).toEqual(Array.from({ length: 100 }, (_, i) => 100 + i));
    expect(second.complete).toBe(false);

    const third = await service.fetch('conn-1', 'user-1', opened.sessionId, 100);
    expect(third.rows).toHaveLength(50);
    expect(third.complete).toBe(true);
    expect(cursors[0]!.close).toHaveBeenCalled();

    // The session is gone once complete.
    await expect(service.fetch('conn-1', 'user-1', opened.sessionId, 100)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces the total-row budget and signals truncation', async () => {
    const { service } = makeHarness({ cursors: [makeCursor(1000)], config: { STREAM_MAX_ROWS: 150 } });
    const opened = await service.open('conn-1', 'user-1', 'SELECT * FROM huge');
    expect(opened.rows).toHaveLength(100);

    const block = await service.fetch('conn-1', 'user-1', opened.sessionId, 100);
    expect(block.rows).toHaveLength(50); // capped at the 150-row budget
    expect(block.truncated).toBe(true);
    expect(block.complete).toBe(true);

    await expect(service.fetch('conn-1', 'user-1', opened.sessionId, 100)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a fetch for another user's session", async () => {
    const { service } = makeHarness();
    const opened = await service.open('conn-1', 'user-1', 'SELECT * FROM big');
    await expect(service.fetch('conn-1', 'attacker', opened.sessionId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.fetch('conn-other', 'user-1', opened.sessionId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects opening a cursor on an engine without cursor support', async () => {
    const { service } = makeHarness({ supportsCursors: false });
    await expect(service.open('conn-1', 'user-1', 'SELECT 1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps concurrent cursors per connection', async () => {
    const cursors = [makeCursor(250), makeCursor(250), makeCursor(250), makeCursor(250)];
    const { service } = makeHarness({ cursors, config: { STREAM_MAX_CURSORS_PER_CONNECTION: 3 } });
    await service.open('conn-1', 'user-1', 'SELECT 1');
    await service.open('conn-1', 'user-1', 'SELECT 2');
    await service.open('conn-1', 'user-1', 'SELECT 3');
    await expect(service.open('conn-1', 'user-1', 'SELECT 4')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('closes a session explicitly and is a no-op for unknown sessions', async () => {
    const { service, cursors } = makeHarness();
    const opened = await service.open('conn-1', 'user-1', 'SELECT * FROM big');
    await service.close('conn-1', 'user-1', opened.sessionId);
    expect(cursors[0]!.close).toHaveBeenCalled();
    await expect(service.close('conn-1', 'user-1', 'no-such-session')).resolves.toBeUndefined();
  });

  it('reaps idle sessions and releases their cursors', async () => {
    vi.useFakeTimers();
    const { service, cursors } = makeHarness({ cursors: [makeCursor(250)], config: { STREAM_CURSOR_IDLE_MS: 2000 } });
    service.onModuleInit();
    const opened = await service.open('conn-1', 'user-1', 'SELECT * FROM big');

    await vi.advanceTimersByTimeAsync(3000);

    expect(cursors[0]!.close).toHaveBeenCalled();
    await expect(service.fetch('conn-1', 'user-1', opened.sessionId)).rejects.toBeInstanceOf(NotFoundException);
    await service.onModuleDestroy();
  });
});
