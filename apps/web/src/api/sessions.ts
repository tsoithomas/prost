import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DbSession, KillSessionMode } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

/** Live-session snapshot (Phase 27). Pass a `refetchInterval` to enable bounded auto-refresh. */
export function useSessions(
  connectionId: string | null,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['sessions', connectionId],
    queryFn: () => apiFetch<DbSession[]>(`/connections/${connectionId}/sessions`),
    enabled: (options?.enabled ?? true) && connectionId !== null,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useKillSession(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, mode }: { sessionId: string | number; mode: KillSessionMode }) =>
      apiFetch<void>(`/connections/${connectionId}/sessions/${sessionId}/kill`, {
        method: 'POST',
        body: { mode },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions', connectionId] }),
  });
}
