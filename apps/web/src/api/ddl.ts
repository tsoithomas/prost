import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTableBody, CreateTableResult } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useCreateTable(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTableBody) =>
      apiFetch<CreateTableResult>(`/connections/${connectionId}/ddl/tables`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['metadata', connectionId] });
    },
  });
}
