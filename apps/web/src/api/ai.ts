import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChatRequest,
  ChatResponse,
  CreateLlmEndpointBody,
  LlmEndpointDto,
  UpdateLlmEndpointBody,
} from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

const ENDPOINTS_KEY = ['llm-endpoints'];

export function useLlmEndpoints() {
  return useQuery({
    queryKey: ENDPOINTS_KEY,
    queryFn: () => apiFetch<LlmEndpointDto[]>('/llm-endpoints'),
    staleTime: 30_000,
  });
}

export function useCreateLlmEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLlmEndpointBody) =>
      apiFetch<LlmEndpointDto>('/llm-endpoints', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ENDPOINTS_KEY }),
  });
}

export function useUpdateLlmEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLlmEndpointBody }) =>
      apiFetch<LlmEndpointDto>(`/llm-endpoints/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ENDPOINTS_KEY }),
  });
}

export function useDeleteLlmEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/llm-endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ENDPOINTS_KEY }),
  });
}

export function useAiChat(connectionId: string | null) {
  return useMutation({
    mutationFn: (req: ChatRequest) =>
      apiFetch<ChatResponse>(`/connections/${connectionId!}/ai/chat`, {
        method: 'POST',
        body: req,
      }),
  });
}
