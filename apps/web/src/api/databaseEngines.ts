import { useQuery } from '@tanstack/react-query';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

export function useDatabaseEngines() {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: ['database-engines'],
    queryFn: () => apiFetch<DbEngineDescriptor[]>('/database-engines'),
    enabled: token !== null,
    staleTime: Infinity,
  });
}
