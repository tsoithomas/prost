import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppendMessagesBody,
  ChatRequest,
  ChatResponse,
  ConversationDetailDto,
  ConversationDto,
  CreateLlmEndpointBody,
  LlmEndpointDto,
  LlmProbeBody,
  LlmProbeResult,
  UpdateLlmEndpointBody,
} from '@prost/shared-types';
import { ApiError, BASE_URL, apiFetch } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

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

/** Best-effort model + context-window discovery from an endpoint's /v1/models, to prefill the form. */
export function useProbeLlmEndpoint() {
  return useMutation({
    mutationFn: (body: LlmProbeBody) =>
      apiFetch<LlmProbeResult>('/llm-endpoints/probe', { method: 'POST', body }),
  });
}

// --- Conversations (persistent chat history) ---

const conversationsKey = (connectionId: string) => ['conversations', connectionId];

export function useConversations(connectionId: string | null) {
  return useQuery({
    queryKey: conversationsKey(connectionId ?? ''),
    queryFn: () => apiFetch<ConversationDto[]>(`/connections/${connectionId!}/conversations`),
    enabled: connectionId !== null,
    staleTime: 10_000,
  });
}

export function fetchConversation(connectionId: string, conversationId: string) {
  return apiFetch<ConversationDetailDto>(
    `/connections/${connectionId}/conversations/${conversationId}`,
  );
}

export function useAppendConversation(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AppendMessagesBody) =>
      apiFetch<ConversationDto>(`/connections/${connectionId}/conversations`, {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: conversationsKey(connectionId) }),
  });
}

export function useDeleteConversation(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<void>(`/connections/${connectionId}/conversations/${conversationId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: conversationsKey(connectionId) }),
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

export interface ChatTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface StreamAiChatHandlers {
  /** Called for each content delta as the model produces it. */
  onDelta: (delta: string) => void;
  /** Called once at the end with token counts, when the endpoint reports them. */
  onUsage?: (usage: ChatTokenUsage) => void;
  /** Abort the request (Stop button); rejects the promise with an `AbortError`. */
  signal?: AbortSignal;
}

/**
 * Streams a chat completion over SSE (`POST :id/ai/chat/stream`). Resolves when the model is done,
 * rejects with an `ApiError` on a pre-stream failure or an `Error` on a mid-stream provider failure.
 * The caller accumulates the deltas into the assistant message.
 */
export async function streamAiChat(
  connectionId: string,
  req: ChatRequest,
  handlers: StreamAiChatHandlers,
): Promise<void> {
  const { token } = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}/connections/${connectionId}/ai/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
    signal: handlers.signal,
  });

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string; message?: string; correlationId?: string }
      | null;
    if (response.status === 401) {
      useAuthStore.getState().clear();
    }
    throw new ApiError(
      response.status,
      (data?.error as ApiError['code']) ?? 'INTERNAL_ERROR',
      data?.message ?? response.statusText,
      data?.correlationId ?? '',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const { event, data } = parseSseFrame(frame);
      if (event === 'done') return;
      if (event === 'error') {
        const parsed = safeJson(data);
        throw new Error(parsed?.message ?? 'AI provider request failed.');
      }
      if (event === 'usage') {
        const parsed = safeJson(data);
        if (parsed && handlers.onUsage) {
          handlers.onUsage({
            promptTokens: parsed.promptTokens ?? 0,
            completionTokens: parsed.completionTokens ?? 0,
            totalTokens: parsed.totalTokens ?? 0,
          });
        }
        continue;
      }
      const parsed = safeJson(data);
      if (parsed?.delta) handlers.onDelta(parsed.delta);
    }
  }
}

function parseSseFrame(frame: string): { event: string; data: string } {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join('\n') };
}

function safeJson(
  text: string,
): { delta?: string; message?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number } | null {
  try {
    return JSON.parse(text) as ReturnType<typeof safeJson>;
  } catch {
    return null;
  }
}
