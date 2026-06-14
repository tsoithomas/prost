import { useMutation } from '@tanstack/react-query';
import type { ExecuteQueryBody, ExecuteQueryResponse } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useExecuteQuery(connectionId: string) {
  return useMutation({
    mutationFn: (body: ExecuteQueryBody) =>
      apiFetch<ExecuteQueryResponse>(`/connections/${connectionId}/query`, { method: 'POST', body }),
  });
}
