/**
 * Active-session monitoring (Phase 27). A read-only snapshot of the target DB's live sessions plus a
 * guarded cancel/terminate action, capability-gated per engine (`supportsSessionMonitoring`). Query
 * text is surfaced (like history), but never bound values or result rows (principles §1, §12).
 */
export interface DbSession {
  /** Backend/process id (PG pid, MySQL PROCESSLIST id). */
  id: string | number;
  user?: string;
  database?: string;
  clientAddr?: string;
  /** e.g. active | idle | idle in transaction (PG); Query/Sleep (MySQL). */
  state?: string;
  /** The current/last statement text — no bound values. */
  query?: string;
  durationMs?: number;
  waitEvent?: string;
  /** Ids of the session(s) blocking this one (PG `pg_blocking_pids`; MySQL lock-waits, best-effort). */
  blockedBy?: (string | number)[];
}

/** Cancel = graceful (PG `pg_cancel_backend` / MySQL `KILL QUERY`); terminate = force (`pg_terminate_backend` / `KILL CONNECTION`). */
export type KillSessionMode = 'cancel' | 'terminate';

/** Request body for `POST /connections/:id/sessions/:sessionId/kill`. */
export interface KillSessionBody {
  mode: KillSessionMode;
}
