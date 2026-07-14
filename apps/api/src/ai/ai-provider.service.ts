import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ChatMessage } from '@prost/shared-types';

// Upper bound on the model's *reply* length. Env-configurable so large-context endpoints can allow
// longer answers without a code change; a per-endpoint override can layer on later.
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env['AI_MAX_OUTPUT_TOKENS']) || 2048;

// Cap the tool-call ↔ answer round-trips so a misbehaving model can't loop forever.
const MAX_TOOL_ROUNDS = 5;

/** A function tool offered to the model, with its executor. */
export interface ChatTool {
  name: string;
  description: string;
  /** JSON-schema for the tool's arguments. */
  parameters: Record<string, unknown>;
  /** Runs the tool; returns a string result fed back to the model. */
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface CompleteOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  /** Overrides the env/default reply-length cap. */
  maxOutputTokens?: number;
  /** Function tools the model may call mid-answer (streaming path only). */
  tools?: ChatTool[];
}

/** Token usage for one completion, when the endpoint reports it (many compat servers omit it). */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Accumulates a streamed tool call across chunk deltas. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

@Injectable()
export class AiProviderService {
  /** Calls an OpenAI-compatible /chat/completions endpoint built from the given config. */
  async complete(opts: CompleteOptions): Promise<string> {
    const res = await this.client(opts).chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages: this.buildMessages(opts),
    });
    return res.choices[0]?.message?.content ?? '';
  }

  /**
   * Streaming counterpart to `complete`: yields content deltas as the model produces them, for the
   * SSE chat endpoint. If `opts.tools` are supplied and the model calls one, it's executed and the
   * result fed back, looping (bounded by `MAX_TOOL_ROUNDS`) until the model answers — endpoints
   * without tool support simply never call one, so this degrades gracefully. `onUsage` fires once
   * at the end with cumulative token counts *if* the endpoint reports them
   * (`stream_options.include_usage`); many OpenAI-compatible servers omit it, so it's best-effort.
   */
  async *completeStream(
    opts: CompleteOptions,
    onUsage?: (usage: TokenUsage) => void,
  ): AsyncGenerator<string> {
    const client = this.client(opts);
    const messages = this.buildMessages(opts);
    const tools = opts.tools?.length ? opts.tools.map(toOpenAiTool) : undefined;
    const acc: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await client.chat.completions.create({
          model: opts.model,
          max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
          messages,
          ...(tools ? { tools, tool_choice: 'auto' as const } : {}),
        });

        const pending = new Map<number, PendingToolCall>();
        let finish: string | null = null;

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (choice?.delta?.content) yield choice.delta.content;
          for (const tc of choice?.delta?.tool_calls ?? []) {
            const cur = pending.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            pending.set(tc.index, cur);
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) {
            acc.promptTokens += chunk.usage.prompt_tokens;
            acc.completionTokens += chunk.usage.completion_tokens;
            acc.totalTokens += chunk.usage.total_tokens;
          }
        }

        // Done unless the model asked for tools this round.
        if (finish !== 'tool_calls' || pending.size === 0 || !tools) return;

        const calls = [...pending.values()];
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.args || '{}' },
          })),
        });
        for (const call of calls) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: await this.runTool(opts.tools!, call),
          });
        }
        // Loop: the next round streams the model's continuation given the tool results.
      }
    } finally {
      if (onUsage && acc.totalTokens > 0) onUsage(acc);
    }
  }

  private async runTool(tools: ChatTool[], call: PendingToolCall): Promise<string> {
    const tool = tools.find((t) => t.name === call.name);
    if (!tool) return `Unknown tool: ${call.name}`;
    try {
      const args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
      return await tool.execute(args);
    } catch {
      return `Error executing ${call.name}.`;
    }
  }

  private client(opts: CompleteOptions): OpenAI {
    return new OpenAI({ baseURL: opts.baseUrl, apiKey: opts.apiKey || 'noauth' });
  }

  private buildMessages(opts: CompleteOptions): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: opts.systemPrompt },
      ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
  }
}

function toOpenAiTool(tool: ChatTool): ChatCompletionTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
