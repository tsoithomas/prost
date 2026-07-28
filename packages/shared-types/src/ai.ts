import type { ColumnMetadata } from './metadata.js';
import type { ExecuteQueryResponse } from './grid.js';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  endpointId: string;
  model: string;
}

export interface ChatResponse {
  message: ChatMessage;
  suggestedSql?: string;
}

/** Ask the agent's read-only executor to run a proposed SELECT (Phase 31). */
export interface RunReadQueryRequest {
  sql: string;
}

/**
 * A bounded, sanitized preview of a query result for the LLM to reason over — capped rows AND columns,
 * cell strings truncated (Decision-1: the model never sees the wholesale result the grid shows).
 */
export interface RowSample {
  columns: string[];
  rows: unknown[][];
  /** True when rows and/or columns were capped below the full result. */
  truncated: boolean;
}

/**
 * The outcome of a gated read-only run: `result` is the full bounded page for the grid; `sample` is the
 * capped projection sent back to the model. One execution, two projections.
 */
export interface RunReadQueryResponse {
  sql: string;
  result: ExecuteQueryResponse;
  sample: RowSample;
}

/** The chart kinds the result-insights view can render (Phase 29). */
export type ChartType = 'bar' | 'line' | 'pie';

/**
 * How the chart groups rows by the category column (Phase 29.1). `none` plots raw rows 1:1;
 * `count` counts rows per category (value column ignored); the rest aggregate the numeric value
 * column per category.
 */
export type ChartAggregation = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max';

/**
 * An AI-suggested chart over a result page: a type, the category (x) and value (y) columns, and how to
 * aggregate the value per category. The server always fills `aggregation` (defaulting to `sum`).
 */
export interface ChartSuggestion {
  type: ChartType;
  categoryColumn: string;
  valueColumn: string;
  aggregation: ChartAggregation;
}

/**
 * Request an AI chart suggestion for an already-loaded result page. Carries the column metadata and a
 * small, capped sample of rows (the server caps + sanitizes defensively) — an explicit, opt-in
 * exception to the no-row-data posture, scoped to this one suggestion (Phase 29 Decision 3).
 */
export interface ChartSuggestRequest {
  endpointId: string;
  model: string;
  columns: ColumnMetadata[];
  sample: Record<string, unknown>[];
}

/** The suggestion, or `null` when the model couldn't produce a valid one (charting still works manually). */
export interface ChartSuggestResponse {
  suggestion: ChartSuggestion | null;
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
