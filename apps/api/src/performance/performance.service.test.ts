import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbDriver } from '../database/db-driver.interface';
import { PoolManager } from '../database/pool-manager.service';
import { PERF_STATEMENT_LIMIT, PerformanceService } from './performance.service';

function setup(
  options: {
    supported?: boolean;
    status?: Record<string, unknown> | Error;
    statements?: Record<string, unknown>[] | Error;
    window?: Record<string, unknown> | Error;
    classified?: { reason: 'permission_denied'; message: string } | null;
  } = {},
) {
  const driver = {
    descriptor: { supportsPerfInsights: options.supported ?? true },
    buildPerfInsightsStatus: vi.fn(() => ({ sql: 'STATUS', params: [] })),
    buildListTopStatements: vi.fn((limit: number) => ({ sql: 'LIST', params: [limit] })),
    buildPerfInsightsWindow: vi.fn(() => ({ sql: 'WINDOW', params: [] })),
    classifyPerfInsightsError: vi.fn(() => options.classified ?? null),
  } as unknown as DbDriver;
  const run = vi.fn(async (_connectionId: string, fragment: { sql: string }) => {
    const value =
      fragment.sql === 'STATUS'
        ? (options.status ?? { available: true })
        : fragment.sql === 'WINDOW'
          ? (options.window ?? {})
          : (options.statements ?? []);
    if (value instanceof Error) throw value;
    return { rows: fragment.sql === 'LIST' ? value : [value] };
  });
  const pool = { driverFor: vi.fn(async () => driver), run } as unknown as PoolManager;
  return { service: new PerformanceService(pool), driver, run };
}

describe('PerformanceService', () => {
  it('maps a bounded available snapshot to the shared camel-case shape', async () => {
    const { service, driver } = setup({
      window: {
        statistics_since: new Date('2026-08-05T19:33:17.000Z'),
        approximate: 1,
      },
      statements: [
        {
          query: '  SELECT * FROM orders WHERE user_id = $1  ',
          calls: '12',
          total_time_ms: '123.45',
          mean_time_ms: '10.2875',
          rows: '24',
        },
        { query: null, calls: 1 },
      ],
    });

    await expect(service.getSnapshot('c1')).resolves.toEqual({
      status: 'available',
      statements: [
        {
          query: 'SELECT * FROM orders WHERE user_id = $1',
          calls: 12,
          totalTimeMs: 123.45,
          meanTimeMs: 10.2875,
          rows: 24,
        },
      ],
      statisticsWindow: {
        since: '2026-08-05T19:33:17.000Z',
        approximate: true,
      },
    });
    expect(driver.buildListTopStatements).toHaveBeenCalledWith(PERF_STATEMENT_LIMIT);
  });

  it('keeps a valid snapshot when optional window metadata is unavailable', async () => {
    const { service } = setup({ window: new Error('info view unavailable') });

    await expect(service.getSnapshot('c1')).resolves.toEqual({
      status: 'available',
      statements: [],
    });
  });

  it('returns an actionable unavailable snapshot without running the list', async () => {
    const { service, driver } = setup({
      status: {
        available: false,
        unavailable_reason: 'not_configured',
        unavailable_message: 'pg_stat_statements is not installed in this database.',
      },
    });
    await expect(service.getSnapshot('c1')).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_configured',
      message: 'pg_stat_statements is not installed in this database.',
    });
    expect(driver.buildListTopStatements).not.toHaveBeenCalled();
  });

  it('classifies known permission failures but propagates unrelated failures', async () => {
    const denied = setup({
      status: new Error('denied'),
      classified: { reason: 'permission_denied', message: 'Needs SELECT access.' },
    });
    await expect(denied.service.getSnapshot('c1')).resolves.toEqual({
      status: 'unavailable',
      reason: 'permission_denied',
      message: 'Needs SELECT access.',
    });

    const broken = setup({ status: new Error('connection lost') });
    await expect(broken.service.getSnapshot('c1')).rejects.toThrow('connection lost');
  });

  it('rejects engines whose static capability is off before running target SQL', async () => {
    const { service, run } = setup({ supported: false });
    await expect(service.getSnapshot('c1')).rejects.toThrow(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });
});
