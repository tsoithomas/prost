import { useMutation } from '@tanstack/react-query';
import type { ExecuteQueryBody, ExecuteQueryResponse, ExplainQueryBody, QueryPlanResult } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useExecuteQuery(connectionId: string) {
  return useMutation({
    mutationFn: (body: ExecuteQueryBody) =>
      apiFetch<ExecuteQueryResponse>(`/connections/${connectionId}/query`, { method: 'POST', body }),
  });
}

/** Structured query plan for a single statement (Phase 26). `analyze` runs the statement (PG only). */
export function useExplainQuery(connectionId: string) {
  return useMutation({
    mutationFn: (body: ExplainQueryBody) =>
      apiFetch<QueryPlanResult>(`/connections/${connectionId}/query/explain`, { method: 'POST', body }),
  });
}
