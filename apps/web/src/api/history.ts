import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HistoryExportEntry, QueryHistoryDto, UpdateHistoryRequest } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

export function useQueryHistory(connectionId: string | null) {
  return useQuery({
    queryKey: ['history', connectionId],
    queryFn: () => apiFetch<QueryHistoryDto[]>(`/connections/${connectionId}/history`),
    enabled: connectionId !== null,
  });
}

export interface HistorySearchParams {
  /** `null` = all connections (cross-connection view); a string scopes to one connection. */
  connectionId: string | null;
  search: string;
  /** Skip the fetch entirely (e.g. no active connection and the "All connections" view is off). */
  enabled?: boolean;
}

/** Bounded, server-side history search. Powers both the per-connection list and the "All connections" view. */
export function useHistorySearch({ connectionId, search, enabled = true }: HistorySearchParams) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: ['history', connectionId ?? 'all', search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (connectionId !== null) params.set('connectionId', connectionId);
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      return apiFetch<QueryHistoryDto[]>(`/history${qs ? `?${qs}` : ''}`);
    },
    enabled: token !== null && enabled,
  });
}

export function useUpdateHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateHistoryRequest) =>
      apiFetch<QueryHistoryDto>(`/history/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['history'] }); },
  });
}

export function useDeleteHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/history/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['history'] }); },
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string | null) =>
      apiFetch<void>(`/history${connectionId !== null ? `?connectionId=${encodeURIComponent(connectionId)}` : ''}`, {
        method: 'DELETE',
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['history'] }); },
  });
}

/** Fetches the user's full history (SQL text + metadata only) and triggers a client-side JSON download. */
export function useHistoryExport() {
  return useMutation({
    mutationFn: async () => {
      const entries = await apiFetch<HistoryExportEntry[]>('/history/export');
      if (typeof window === 'undefined') return entries;
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `prost-history-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      return entries;
    },
  });
}
