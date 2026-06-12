import { useMutation, useQuery } from '@tanstack/react-query';
import type { UserPreferenceDto } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

export function usePreferences() {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: ['preferences'],
    queryFn: () => apiFetch<UserPreferenceDto>('/preferences'),
    enabled: token !== null,
  });
}

export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (dto: Partial<UserPreferenceDto>) =>
      apiFetch<UserPreferenceDto>('/preferences', { method: 'PATCH', body: dto }),
  });
}
