import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PoolManager } from '../database/pool-manager.service';
import { SessionsService } from './sessions.service';

interface HarnessOptions {
  supports?: boolean;
  sessionRows?: Record<string, unknown>[];
  blockingFrag?: { sql: string; params: unknown[] } | null;
  blockingRows?: Record<string, unknown>[] | Error;
  readOnly?: boolean;
}

function makeService(opts: HarnessOptions = {}) {
  const driver = {
    descriptor: { supportsSessionMonitoring: opts.supports ?? true },
    buildListSessions: vi.fn(() => ({ sql: 'LIST', params: [] })),
    buildBlockingPairs: vi.fn(() => opts.blockingFrag ?? null),
    buildKillSession: vi.fn((id: number, mode: string) => ({ sql: `KILL:${mode}:${id}`, params: [] })),
  };
  const run = vi.fn(async (_conn: string, frag: { sql: string }) => {
    if (frag.sql === 'BLOCK') {
      if (opts.blockingRows instanceof Error) throw opts.blockingRows;
      return { rows: opts.blockingRows ?? [] };
    }
    if (frag.sql === 'LIST') return { rows: opts.sessionRows ?? [] };
    return { rows: [] };
  });
  const assertWritable = vi.fn(async () => {
    if (opts.readOnly) throw new ForbiddenException('This connection is read-only');
  });
  const pool = { driverFor: vi.fn(async () => driver), run, assertWritable } as unknown as PoolManager;
  return { service: new SessionsService(pool), run, driver, assertWritable };
}

describe('SessionsService.listSessions', () => {
  it('rejects when the engine does not support session monitoring', async () => {
    const { service } = makeService({ supports: false });
    await expect(service.listSessions('c1')).rejects.toThrow(BadRequestException);
  });

  it('maps rows to the DbSession shape (rounding duration, folding array blocked-by)', async () => {
    const { service } = makeService({
      sessionRows: [
        { id: 10, user: 'app', database: 'demo', client_addr: '1.2.3.4', state: 'active', query: 'SELECT 1', duration_ms: 1234.6, wait_event: null, blocked_by: [5] },
      ],
    });
    const sessions = await service.listSessions('c1');
    expect(sessions[0]).toMatchObject({ id: 10, user: 'app', database: 'demo', state: 'active', durationMs: 1235, blockedBy: [5] });
    expect(sessions[0]!.waitEvent).toBeUndefined();
  });

  it('merges best-effort blocker pairs (MySQL) into blocked-by', async () => {
    const { service } = makeService({
      sessionRows: [{ id: 10 }, { id: 11 }],
      blockingFrag: { sql: 'BLOCK', params: [] },
      blockingRows: [{ blocked_id: 10, blocking_id: 7 }],
    });
    const sessions = await service.listSessions('c1');
    expect(sessions.find((s) => s.id === 10)!.blockedBy).toEqual([7]);
    expect(sessions.find((s) => s.id === 11)!.blockedBy).toBeUndefined();
  });

  it('still returns the list when the blockers query fails (performance_schema off)', async () => {
    const { service } = makeService({
      sessionRows: [{ id: 10 }],
      blockingFrag: { sql: 'BLOCK', params: [] },
      blockingRows: new Error('performance_schema disabled'),
    });
    const sessions = await service.listSessions('c1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.blockedBy).toBeUndefined();
  });
});

describe('SessionsService.killSession', () => {
  it('is rejected on a read-only connection (before running anything)', async () => {
    const { service, run } = makeService({ readOnly: true });
    await expect(service.killSession('c1', '5', 'terminate')).rejects.toThrow(ForbiddenException);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a non-integer session id', async () => {
    const { service } = makeService();
    await expect(service.killSession('c1', 'abc', 'cancel')).rejects.toThrow(BadRequestException);
  });

  it('runs the driver kill for a valid id', async () => {
    const { service, run, driver } = makeService();
    await service.killSession('c1', '42', 'cancel');
    expect(driver.buildKillSession).toHaveBeenCalledWith(42, 'cancel');
    expect(run).toHaveBeenCalledWith('c1', { sql: 'KILL:cancel:42', params: [] });
  });

  it('rejects when the engine does not support session monitoring', async () => {
    const { service } = makeService({ supports: false });
    await expect(service.killSession('c1', '5', 'cancel')).rejects.toThrow(BadRequestException);
  });
});
