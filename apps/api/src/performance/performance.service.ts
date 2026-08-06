import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PerfInsightsUnavailableReason,
  PerformanceInsightsSnapshot,
  StatementStat,
} from '@prost/shared-types';
import type { DbDriver } from '../database/db-driver.interface';
import { PoolManager } from '../database/pool-manager.service';

export const PERF_STATEMENT_LIMIT = 100;

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function isoTimestamp(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function unavailableReason(value: unknown): PerfInsightsUnavailableReason {
  if (value === 'not_configured' || value === 'permission_denied') return value;
  return 'collection_disabled';
}

function knownUnavailable(driver: DbDriver, error: unknown): PerformanceInsightsSnapshot | null {
  const unavailable = driver.classifyPerfInsightsError(error);
  return unavailable ? { status: 'unavailable', ...unavailable } : null;
}

/** Pull-only target-database statement statistics (Phase 41). Nothing is cached or persisted. */
@Injectable()
export class PerformanceService {
  constructor(private readonly pool: PoolManager) {}

  async getSnapshot(connectionId: string): Promise<PerformanceInsightsSnapshot> {
    const driver = await this.pool.driverFor(connectionId);
    if (!driver.descriptor.supportsPerfInsights) {
      throw new BadRequestException('Performance insights are not supported for this engine');
    }

    let statusRow: Record<string, unknown> | undefined;
    try {
      const { rows } = await this.pool.run(connectionId, driver.buildPerfInsightsStatus());
      statusRow = rows[0];
    } catch (error) {
      const unavailable = knownUnavailable(driver, error);
      if (unavailable) return unavailable;
      throw error;
    }

    if (!statusRow) throw new Error('Performance insights status query returned no rows');
    if (!asBoolean(statusRow.available)) {
      return {
        status: 'unavailable',
        reason: unavailableReason(statusRow.unavailable_reason),
        message:
          typeof statusRow.unavailable_message === 'string' &&
          statusRow.unavailable_message.length > 0
            ? statusRow.unavailable_message
            : 'Statement statistics collection is unavailable for this connection.',
      };
    }

    try {
      const { rows } = await this.pool.run(
        connectionId,
        driver.buildListTopStatements(PERF_STATEMENT_LIMIT),
      );
      const statements = rows
        .map((row): StatementStat | null => {
          const query = typeof row.query === 'string' ? row.query.trim() : '';
          if (!query) return null;
          return {
            query,
            calls: nonNegativeNumber(row.calls),
            totalTimeMs: nonNegativeNumber(row.total_time_ms),
            meanTimeMs: nonNegativeNumber(row.mean_time_ms),
            rows: nonNegativeNumber(row.rows),
          };
        })
        .filter((statement): statement is StatementStat => statement !== null);

      // Window metadata is supplementary. Older pg_stat_statements versions do not expose
      // pg_stat_statements_info, so a missing/forbidden metadata view must not hide valid stats.
      let statisticsWindow:
        | { since: string; approximate: boolean }
        | undefined;
      try {
        const windowResult = await this.pool.run(
          connectionId,
          driver.buildPerfInsightsWindow(),
        );
        const windowRow = windowResult.rows[0];
        const since = isoTimestamp(windowRow?.statistics_since);
        if (since) {
          statisticsWindow = { since, approximate: asBoolean(windowRow?.approximate) };
        }
      } catch {
        // Best-effort context only; the statement snapshot above is still valid and useful.
      }

      return {
        status: 'available',
        statements,
        ...(statisticsWindow ? { statisticsWindow } : {}),
      };
    } catch (error) {
      const unavailable = knownUnavailable(driver, error);
      if (unavailable) return unavailable;
      throw error;
    }
  }
}
