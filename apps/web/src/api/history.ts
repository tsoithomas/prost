import { useQuery } from '@tanstack/react-query';
import type { QueryHistoryDto } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useQueryHistory(connectionId: string | null) {
  return useQuery({
    queryKey: ['history', connectionId],
    queryFn: () => apiFetch<QueryHistoryDto[]>(`/connections/${connectionId}/history`),
    enabled: connectionId !== null,
  });
}
