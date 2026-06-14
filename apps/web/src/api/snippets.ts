import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSnippetRequest, SnippetDto, UpdateSnippetRequest } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

export function useSnippets() {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: ['snippets'],
    queryFn: () => apiFetch<SnippetDto[]>('/snippets'),
    enabled: token !== null,
  });
}

export function useCreateSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSnippetRequest) => apiFetch<SnippetDto>('/snippets', { method: 'POST', body }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['snippets'] }); },
  });
}

export function useUpdateSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateSnippetRequest) =>
      apiFetch<SnippetDto>(`/snippets/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['snippets'] }); },
  });
}

export function useDeleteSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/snippets/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['snippets'] }); },
  });
}
