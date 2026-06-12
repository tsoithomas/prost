import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectionDto,
  CreateConnectionDto,
  TestConnectionDto,
  TestConnectionResult,
  UpdateConnectionDto,
} from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';
import { useConnectionStore } from '../stores/connectionStore';

const CONNECTIONS_KEY = ['connections'];

export function useConnections() {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: () => apiFetch<ConnectionDto[]>('/connections'),
    enabled: token !== null,
  });
}

/** The connection record for the active connection, if any (per `connectionStore`). */
export function useActiveConnection(): ConnectionDto | undefined {
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const { data: connections } = useConnections();

  return connections?.find((connection) => connection.id === activeConnectionId);
}

export function useCreateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateConnectionDto) =>
      apiFetch<ConnectionDto>('/connections', { method: 'POST', body: dto }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateConnectionDto }) =>
      apiFetch<ConnectionDto>(`/connections/${id}`, { method: 'PATCH', body: dto }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (dto: TestConnectionDto) =>
      apiFetch<TestConnectionResult>('/connections/test', { method: 'POST', body: dto }),
  });
}
