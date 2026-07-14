export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ChatMode = 'ask' | 'generateSql' | 'explain';

export interface ChatRequest {
  messages: ChatMessage[];
  mode?: ChatMode;
  endpointId: string;
  model: string;
}

export interface ChatResponse {
  message: ChatMessage;
  suggestedSql?: string;
}

/** A persisted chat thread (summary form, for the conversation list). */
export interface ConversationDto {
  id: string;
  connectionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A conversation plus its ordered messages (for resuming a thread). */
export interface ConversationDetailDto extends ConversationDto {
  messages: ChatMessage[];
}

/** Persist a completed exchange: the user turn and the assistant reply, appended to a thread. */
export interface AppendMessagesBody {
  /** Omit to start a new conversation; the server returns its id. */
  conversationId?: string;
  messages: ChatMessage[];
}

export interface LlmEndpointDto {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  /** Per-endpoint schema-context budget in characters; null → server env default. */
  contextBudget: number | null;
  /** Per-endpoint reply-length cap in tokens; null → server env default. */
  maxOutputTokens: number | null;
  createdAt: string;
}

export interface CreateLlmEndpointBody {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  contextBudget?: number | null;
  maxOutputTokens?: number | null;
}

export interface UpdateLlmEndpointBody {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  contextBudget?: number | null;
  maxOutputTokens?: number | null;
}

/** Result of probing an endpoint's `/v1/models` (best-effort model discovery + context window). */
export interface LlmProbeResult {
  models: string[];
  /** A context length reported by the endpoint (chars ≈ tokens×4), when available. */
  contextLength: number | null;
}

export interface LlmProbeBody {
  baseUrl: string;
  apiKey: string;
}
