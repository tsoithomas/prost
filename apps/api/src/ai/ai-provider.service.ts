import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatMessage } from '@prost/shared-types';

export interface CompleteOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
}

@Injectable()
export class AiProviderService {
  /** Calls an OpenAI-compatible /chat/completions endpoint built from the given config. */
  async complete(opts: CompleteOptions): Promise<string> {
    const client = new OpenAI({ baseURL: opts.baseUrl, apiKey: opts.apiKey || 'noauth' });
    const res = await client.chat.completions.create({
      model: opts.model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  }
}
