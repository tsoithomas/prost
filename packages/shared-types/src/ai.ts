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

export interface LlmEndpointDto {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  createdAt: string;
}

export interface CreateLlmEndpointBody {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface UpdateLlmEndpointBody {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
}
