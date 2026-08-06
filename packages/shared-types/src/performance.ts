/** One normalized statement from a target database's on-demand performance snapshot (Phase 41). */
export interface StatementStat {
  /** Normalized SQL text only; never bound values or result rows. */
  query: string;
  calls: number;
  totalTimeMs: number;
  meanTimeMs: number;
  /** Total rows returned or affected across all calls. */
  rows: number;
}

export type PerfInsightsUnavailableReason =
  | 'not_configured'
  | 'collection_disabled'
  | 'permission_denied';

/**
 * A pull-only snapshot. Instrumentation/configuration gaps are data, not request failures, so the UI
 * can render an actionable empty state while unrelated target-database errors still use the normal
 * error envelope.
 */
export type PerformanceInsightsSnapshot =
  | {
      status: 'available';
      statements: StatementStat[];
      /** Best available start of the engine's current statement-statistics window. */
      statisticsWindow?: {
        since: string;
        /** MySQL exposes the earliest retained digest, which closely approximates a reset time. */
        approximate: boolean;
      };
    }
  | {
      status: 'unavailable';
      reason: PerfInsightsUnavailableReason;
      message: string;
    };
