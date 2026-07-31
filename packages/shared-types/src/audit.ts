/**
 * Audit trail of write + DDL actions (Phase 28). App-DB only; stores SQL text + identifiers, never
 * bound values, row data, or credentials (principles §1, §12). Distinct from query history: it
 * isolates mutations/DDL and records **failures** as well as successes, for accountability.
 */
export type AuditAction = 'insert' | 'update' | 'delete' | 'ddl' | 'truncate' | 'import' | 'reveal';
export type AuditOutcome = 'success' | 'failure';

export const AUDIT_ACTIONS: readonly AuditAction[] = ['insert', 'update', 'delete', 'ddl', 'truncate', 'import', 'reveal'];
export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ['success', 'failure'];

export interface AuditEntryDto {
  id: string;
  connectionId: string;
  /** Resolved at read time; `null` when the connection has since been deleted. */
  connectionName: string | null;
  action: AuditAction;
  targetSchema?: string;
  targetTable?: string;
  /** Statement text — identifiers/placeholders only, never bound values or row data. */
  sql: string;
  outcome: AuditOutcome;
  /** Safe error class on failure (Nest exception name / driver code) — never a raw message/stack. */
  errorClass?: string;
  durationMs: number;
  correlationId?: string;
  createdAt: string;
}

/** Filters + cursor paging for `GET /audit`. All optional; omitted filters mean "any". */
export interface AuditQuery {
  connectionId?: string;
  action?: AuditAction;
  outcome?: AuditOutcome;
  /** Inclusive ISO date bounds on `createdAt`. */
  from?: string;
  to?: string;
  limit?: number;
  /** `id` of the last entry from the previous page (newest-first). */
  cursor?: string;
}

export interface AuditListResponse {
  entries: AuditEntryDto[];
  /** Cursor for the next page, or absent when the last page has been reached. */
  nextCursor?: string;
}

/** Lean export shape (identifiers only), mirroring the history export. */
export interface AuditExportEntry {
  action: AuditAction;
  connectionId: string;
  connectionName: string | null;
  targetSchema?: string;
  targetTable?: string;
  sql: string;
  outcome: AuditOutcome;
  errorClass?: string;
  durationMs: number;
  createdAt: string;
}
