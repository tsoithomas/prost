export interface LlmPreset {
  /** Stable key, e.g. 'openai'. */
  id: string;
  /** Default endpoint name shown to the user, e.g. 'OpenAI'. */
  name: string;
  /** OpenAI-compatible base URL (the value the `openai` SDK's `baseUrl` expects). */
  baseUrl: string;
  /** Curated common models — newline-joined into the editable form textarea. */
  models: string[];
  /** Local servers that don't need a real key — softens the API-key hint. */
  keyless?: boolean;
  /** Optional "get an API key" link surfaced under the API Key field. */
  apiKeyUrl?: string;
}

/**
 * Common OpenAI-compatible LLM providers. Every entry consumes the same
 * `LlmEndpoint` shape (`{ name, baseUrl, apiKey, models[] }`) — there is no
 * engine-specific logic here. Model lists are best-effort defaults the user
 * edits freely, so they don't need to be exhaustive or perfectly current
 * (verified against provider docs as of July 2026).
 */
export const llmPresets: LlmPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3',
      'o4-mini',
    ],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-5',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ],
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ],
    apiKeyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      'grok-4.5',
      'grok-4.3',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-multi-agent-0309',
      'grok-build-0.1',
    ],
    apiKeyUrl: 'https://console.x.ai',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'magistral-medium-latest',
      'magistral-small-latest',
      'codestral-latest',
      'devstral-medium-latest',
      'ministral-8b-latest',
      'ministral-3b-latest',
      'pixtral-large-latest',
    ],
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'qwen/qwen3.6-27b',
      'groq/compound',
      'groq/compound-mini',
    ],
    apiKeyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'openai/gpt-5.6',
      'anthropic/claude-opus-4.8',
      'anthropic/claude-sonnet-5',
      'google/gemini-3.5-flash',
      'x-ai/grok-4.5',
      'deepseek/deepseek-v4-pro',
      'meta-llama/llama-4-scout',
      'mistralai/mistral-large',
      'qwen/qwen3.6-27b',
    ],
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      'llama4',
      'llama3.3',
      'qwen3',
      'qwen2.5-coder',
      'deepseek-r1',
      'gpt-oss',
      'gemma3',
      'phi4',
      'mistral',
      'llava',
    ],
    keyless: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    models: ['local-model'],
    keyless: true,
  },
];
