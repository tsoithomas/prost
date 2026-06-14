import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '@prost/shared-types';
import type { ConnectionsService } from '../connections/connections.service';
import type { AiProviderService } from './ai-provider.service';
import type { DecryptedEndpoint, LlmEndpointService } from './llm-endpoint.service';
import type { RetrievalService } from './retrieval.service';
import { AiService } from './ai.service';

const SAMPLE_CONTEXT = `-- public.users\n(\n  id integer PRIMARY KEY,\n  email text NOT NULL\n)`;

const ENDPOINT: DecryptedEndpoint = {
  name: 'My OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-secret',
  models: ['gpt-4o', 'gpt-4o-mini'],
};

function createService({
  ownershipFails = false,
  endpoint = ENDPOINT,
  endpointThrows = false,
  providerResponse = 'Here is your answer.\n```sql\nSELECT * FROM users;\n```',
  providerThrows = false,
}: {
  ownershipFails?: boolean;
  endpoint?: DecryptedEndpoint;
  endpointThrows?: boolean;
  providerResponse?: string;
  providerThrows?: boolean;
} = {}) {
  const connectionsService = {
    assertOwnership: vi.fn().mockImplementation(() => {
      if (ownershipFails) throw new NotFoundException('Connection not found');
    }),
  } as unknown as ConnectionsService;

  const llmEndpointService = {
    getDecrypted: vi.fn().mockImplementation(() => {
      if (endpointThrows) throw new NotFoundException('LLM endpoint not found');
      return Promise.resolve(endpoint);
    }),
  } as unknown as LlmEndpointService;

  const provider = {
    complete: vi.fn().mockImplementation(() => {
      if (providerThrows) throw new Error('network');
      return Promise.resolve(providerResponse);
    }),
  } as unknown as AiProviderService;

  const retrieval = {
    buildContext: vi.fn().mockResolvedValue(SAMPLE_CONTEXT),
  } as unknown as RetrievalService;

  return {
    service: new AiService(connectionsService, llmEndpointService, provider, retrieval),
    connectionsService,
    llmEndpointService,
    provider,
    retrieval,
  };
}

const REQ: ChatRequest = {
  messages: [{ role: 'user', content: 'List the tables.' }],
  endpointId: 'ep-1',
  model: 'gpt-4o',
};

describe('AiService.chat', () => {
  it('asserts ownership before resolving the endpoint', async () => {
    const { service, connectionsService, llmEndpointService } = createService();
    const order: string[] = [];
    connectionsService.assertOwnership = vi.fn().mockImplementation(async () => { order.push('ownership'); });
    llmEndpointService.getDecrypted = vi.fn().mockImplementation(async () => { order.push('endpoint'); return ENDPOINT; });
    await service.chat('user-1', 'conn-1', REQ);
    expect(order[0]).toBe('ownership');
  });

  it('propagates NotFoundException when connection not owned', async () => {
    const { service, llmEndpointService } = createService({ ownershipFails: true });
    await expect(service.chat('user-1', 'conn-1', REQ)).rejects.toThrow(NotFoundException);
    expect(llmEndpointService.getDecrypted).not.toHaveBeenCalled();
  });

  it('propagates NotFoundException when endpoint not owned', async () => {
    const { service, provider } = createService({ endpointThrows: true });
    await expect(service.chat('user-1', 'conn-1', REQ)).rejects.toThrow(NotFoundException);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('rejects a model not on the endpoint with BadRequestException', async () => {
    const { service, provider } = createService();
    await expect(
      service.chat('user-1', 'conn-1', { ...REQ, model: 'gpt-nonexistent' }),
    ).rejects.toThrow(BadRequestException);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('calls the provider with the endpoint base URL, key, and model', async () => {
    const { service, provider } = createService();
    await service.chat('user-1', 'conn-1', REQ);
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.baseUrl).toBe('https://api.openai.com/v1');
    expect(opts.apiKey).toBe('sk-secret');
    expect(opts.model).toBe('gpt-4o');
  });

  it('includes schema context in the system prompt', async () => {
    const { service, provider } = createService();
    await service.chat('user-1', 'conn-1', REQ);
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.systemPrompt).toContain('public.users');
  });

  it('passes mode to the system prompt — generateSql changes role', async () => {
    const { service, provider } = createService();
    await service.chat('user-1', 'conn-1', { ...REQ, mode: 'generateSql' });
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.systemPrompt).toContain('SQL generator');
  });

  it('returns the assistant message with provider content', async () => {
    const { service } = createService();
    const result = await service.chat('user-1', 'conn-1', REQ);
    expect(result.message.role).toBe('assistant');
    expect(result.message.content).toContain('Here is your answer.');
  });

  it('extracts suggestedSql from a ```sql block', async () => {
    const { service } = createService();
    const result = await service.chat('user-1', 'conn-1', REQ);
    expect(result.suggestedSql).toBe('SELECT * FROM users;');
  });

  it('leaves suggestedSql undefined when no sql block present', async () => {
    const { service } = createService({ providerResponse: 'Just a plain answer.' });
    const result = await service.chat('user-1', 'conn-1', REQ);
    expect(result.suggestedSql).toBeUndefined();
  });

  it('maps a provider failure to ServiceUnavailableException', async () => {
    const { service } = createService({ providerThrows: true });
    await expect(service.chat('user-1', 'conn-1', REQ)).rejects.toThrow(ServiceUnavailableException);
  });

  it('runs retrieval before the provider call', async () => {
    const { service, retrieval, provider } = createService();
    const order: string[] = [];
    retrieval.buildContext = vi.fn().mockImplementation(async () => { order.push('retrieval'); return SAMPLE_CONTEXT; });
    provider.complete = vi.fn().mockImplementation(async () => { order.push('provider'); return 'done'; });
    await service.chat('user-1', 'conn-1', REQ);
    expect(order).toEqual(['retrieval', 'provider']);
  });
});
