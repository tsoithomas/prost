import { useQuery } from '@tanstack/react-query';
import type { SchemaMetadata } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useMetadata(connectionId: string | null) {
  return useQuery({
    queryKey: ['metadata', connectionId],
    queryFn: () => apiFetch<SchemaMetadata[]>(`/connections/${connectionId}/metadata`),
    enabled: connectionId !== null,
  });
}
