import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import type { AuditExportEntry, AuditListResponse, AuditQuery } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

/** Filter fields the viewer controls (no `cursor`/`limit` — paging is handled by the hook). */
export type AuditFilters = Omit<AuditQuery, 'cursor' | 'limit'>;

function toParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.connectionId) params.set('connectionId', filters.connectionId);
  if (filters.action) params.set('action', filters.action);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params;
}

/**
 * Cursor-paged audit list (Phase 28). `fetchNextPage` follows `nextCursor` for a "Load more" button;
 * `hasNextPage` is derived from the last page carrying a cursor.
 */
export function useAuditList(filters: AuditFilters) {
  const token = useAuthStore((state) => state.token);
  return useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const params = toParams(filters);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return apiFetch<AuditListResponse>(`/audit${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: token !== null,
  });
}

/** Fetches the filtered audit log (identifiers only) and triggers a client-side JSON download. */
export function useAuditExport(filters: AuditFilters) {
  return useMutation({
    mutationFn: async () => {
      const params = toParams(filters);
      const qs = params.toString();
      const entries = await apiFetch<AuditExportEntry[]>(`/audit/export${qs ? `?${qs}` : ''}`);
      if (typeof window === 'undefined') return entries;
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `prost-audit-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      return entries;
    },
  });
}
