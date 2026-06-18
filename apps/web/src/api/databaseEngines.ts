import { useQuery } from '@tanstack/react-query';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';
import { useConnections } from './connections';

export function useDatabaseEngines() {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: ['database-engines'],
    queryFn: () => apiFetch<DbEngineDescriptor[]>('/database-engines'),
    enabled: token !== null,
    staleTime: Infinity,
  });
}

export function useEngineDescriptor(connectionId: string | null): DbEngineDescriptor | undefined {
  const { data: engines } = useDatabaseEngines();
  const { data: connections } = useConnections();
  const engine = connections?.find((connection) => connection.id === connectionId)?.engine;
  return engines?.find((descriptor) => descriptor.engine === engine);
}
