export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'CONNECTION_ERROR'
  | 'SQL_ERROR'
  | 'TIMEOUT_ERROR'
  | 'INTERNAL_ERROR';

export interface ErrorEnvelope {
  error: ErrorCode;
  message: string;
  correlationId: string;
}
