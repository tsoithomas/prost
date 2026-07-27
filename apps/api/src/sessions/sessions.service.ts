import { BadRequestException, Injectable } from '@nestjs/common';
import type { DbSession, KillSessionMode } from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';

interface SessionRow {
  id: string | number;
  user?: unknown;
  database?: unknown;
  client_addr?: unknown;
  state?: unknown;
  query?: unknown;
  duration_ms?: unknown;
  wait_event?: unknown;
  blocked_by?: unknown;
}

function toStr(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toNum(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** PG `pg_blocking_pids` arrives as a real array; normalize to a non-empty id list or undefined. */
function toIdArray(value: unknown): (string | number)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((v) => v !== null && v !== undefined) as (string | number)[];
  return ids.length > 0 ? ids : undefined;
}

/**
 * Active-session monitoring (Phase 27). Reads a live-session snapshot through the driver seam and
 * runs a guarded cancel/terminate. No target rows or bound values ever leave the seam (§1/§12);
 * killing is gated on the connection being writable (Phase 25).
 */
@Injectable()
export class SessionsService {
  constructor(private readonly pool: PoolManager) {}

  async listSessions(connectionId: string): Promise<DbSession[]> {
    const driver = await this.pool.driverFor(connectionId);
    if (!driver.descriptor.supportsSessionMonitoring) {
      throw new BadRequestException('Session monitoring is not supported for this engine');
    }

    const { rows } = (await this.pool.run(connectionId, driver.buildListSessions())) as unknown as {
      rows: SessionRow[];
    };
    const sessions: DbSession[] = rows.map((row) => ({
      id: row.id,
      user: toStr(row.user),
      database: toStr(row.database),
      clientAddr: toStr(row.client_addr),
      state: toStr(row.state),
      query: toStr(row.query),
      durationMs: toNum(row.duration_ms),
      waitEvent: toStr(row.wait_event),
      blockedBy: toIdArray(row.blocked_by),
    }));

    // Engines that expose blocked-by via a separate query (MySQL) merge it best-effort: a disabled
    // performance_schema must degrade to empty blocked-by, never fail the snapshot.
    const blockersFrag = driver.buildBlockingPairs();
    if (blockersFrag) {
      try {
        const { rows: pairs } = (await this.pool.run(connectionId, blockersFrag)) as unknown as {
          rows: { blocked_id: string | number; blocking_id: string | number }[];
        };
        const byBlocked = new Map<string, (string | number)[]>();
        for (const { blocked_id, blocking_id } of pairs) {
          const key = String(blocked_id);
          byBlocked.set(key, [...(byBlocked.get(key) ?? []), blocking_id]);
        }
        for (const session of sessions) {
          const blockers = byBlocked.get(String(session.id));
          if (blockers && blockers.length > 0) session.blockedBy = blockers;
        }
      } catch {
        // performance_schema unavailable — leave blocked-by empty.
      }
    }

    return sessions;
  }

  async killSession(connectionId: string, sessionId: string, mode: KillSessionMode): Promise<void> {
    const driver = await this.pool.driverFor(connectionId);
    if (!driver.descriptor.supportsSessionMonitoring) {
      throw new BadRequestException('Session monitoring is not supported for this engine');
    }
    // Killing changes server state — a write-class action, so it respects read-only intent (Phase 25).
    await this.pool.assertWritable(connectionId);

    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid session id');
    }
    await this.pool.run(connectionId, driver.buildKillSession(id, mode));
  }
}
