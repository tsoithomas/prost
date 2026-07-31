import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: Partial<UserPreferenceDto>) =>
      apiFetch<UserPreferenceDto>('/preferences', { method: 'PATCH', body: dto }),
    onSuccess: (_result, dto) => {
      // Masking is applied by the *server*, so a change to it invalidates every open grid's read —
      // whoever made it (the column header menu, the Settings roster, a settings import). Invalidating
      // here rather than at each call site means no writer can forget, and doing it on success (not
      // on the optimistic store write) guarantees the refetch sees the persisted preference.
      if (dto.maskedColumns !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ['grid-columns'] });
      }
    },
  });
}
