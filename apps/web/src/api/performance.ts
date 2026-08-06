import { useQuery } from '@tanstack/react-query';
import type { PerformanceInsightsSnapshot } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function usePerformanceInsights(connectionId: string) {
  return useQuery({
    queryKey: ['performance-insights', connectionId],
    queryFn: () =>
      apiFetch<PerformanceInsightsSnapshot>(`/connections/${connectionId}/perf/statements`),
    // Phase 41 is deliberately pull-only: open/mount and the explicit Refresh button are the only
    // triggers. Window focus/reconnect must not turn this into background monitoring.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
