import { BadRequestException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ChartSuggestRequest, ChatRequest, ColumnMetadata } from '@prost/shared-types';
import type { ConnectionsService } from '../connections/connections.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { HistoryService } from '../history/history.service';
import type { AiProviderService } from './ai-provider.service';
import type { DecryptedEndpoint, LlmEndpointService } from './llm-endpoint.service';
import type { RetrievalService } from './retrieval.service';
import type { QueryService } from '../query/query.service';
import type { RowsStatementResult } from '@prost/shared-types';
import { AiService } from './ai.service';

const SAMPLE_CONTEXT = `-- public.users\n(\n  id integer PRIMARY KEY,\n  email text NOT NULL\n)`;

const ENDPOINT: DecryptedEndpoint = {
  name: 'My OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-secret',
  models: ['gpt-4o', 'gpt-4o-mini'],
  contextBudget: null,
  maxOutputTokens: null,
};

function createService({
  ownershipFails = false,
  endpoint = ENDPOINT,
  endpointThrows = false,
  engineLabel = 'PostgreSQL',
  providerResponse = 'Here is your answer.\n```sql\nSELECT * FROM users;\n```',
  providerThrows = false,
  recentQueries = [] as string[],
  runReadOnlyResult,
  runReadOnlyThrows,
}: {
  ownershipFails?: boolean;
  endpoint?: DecryptedEndpoint;
  endpointThrows?: boolean;
  engineLabel?: string;
  providerResponse?: string;
  providerThrows?: boolean;
  recentQueries?: string[];
  runReadOnlyResult?: RowsStatementResult;
  runReadOnlyThrows?: Error;
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
    completeStream: vi.fn().mockReturnValue((async function* () {})()),
  } as unknown as AiProviderService;

  const retrieval = {
    buildContext: vi.fn().mockResolvedValue(SAMPLE_CONTEXT),
    describeTables: vi.fn().mockResolvedValue('-- described'),
  } as unknown as RetrievalService;

  const pool = {
    driverFor: vi.fn().mockResolvedValue({ descriptor: { label: engineLabel } }),
  } as unknown as PoolManager;

  const history = {
    listRecent: vi.fn().mockResolvedValue(recentQueries.map((sql) => ({ sql }))),
  } as unknown as HistoryService;

  const queryService = {
    runReadOnlyQuery: vi.fn().mockImplementation(() => {
      if (runReadOnlyThrows) throw runReadOnlyThrows;
      return Promise.resolve(runReadOnlyResult ?? EMPTY_ROWS_RESULT);
    }),
  } as unknown as QueryService;

  return {
    service: new AiService(connectionsService, llmEndpointService, provider, retrieval, pool, history, queryService),
    connectionsService,
    llmEndpointService,
    provider,
    retrieval,
    pool,
    history,
    queryService,
  };
}

const EMPTY_ROWS_RESULT: RowsStatementResult = {
  kind: 'rows', sql: 'SELECT 1', rows: [], columns: [], totalRows: 0, editable: false, executionTimeMs: 1,
};

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

  it('builds the names-only table index for the connection', async () => {
    const { service, retrieval } = createService();
    await service.chat('user-1', 'conn-1', REQ);
    expect(retrieval.buildContext).toHaveBeenCalledWith('conn-1', expect.any(Object));
  });

  it('includes the user recent queries as few-shot examples', async () => {
    const { service, provider, history } = createService({
      recentQueries: ['SELECT * FROM orders WHERE user_id = 1'],
    });
    await service.chat('user-1', 'conn-1', REQ);
    expect(history.listRecent).toHaveBeenCalledWith('user-1', 'conn-1', expect.any(Number));
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.systemPrompt).toContain('SELECT * FROM orders WHERE user_id = 1');
  });

  it('omits the examples section when there is no history', async () => {
    const { service, provider } = createService({ recentQueries: [] });
    await service.chat('user-1', 'conn-1', REQ);
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.systemPrompt).not.toContain('Recent queries the user has run');
  });

  it('still answers when history retrieval fails', async () => {
    const { service, history } = createService();
    (history.listRecent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const result = await service.chat('user-1', 'conn-1', REQ);
    expect(result.message.role).toBe('assistant');
  });

  describe('streamChat', () => {
    it('offers the get_table_schema tool wired to describeTables', async () => {
      const { service, provider, retrieval } = createService();
      await service.streamChat('user-1', 'conn-1', REQ);
      const opts = (provider.completeStream as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const tool = opts.tools?.find((t: { name: string }) => t.name === 'get_table_schema');
      expect(tool).toBeDefined();
      // The tool's executor forwards names to RetrievalService.describeTables.
      await tool.execute({ tables: ['clients'] });
      expect(retrieval.describeTables).toHaveBeenCalledWith('conn-1', ['clients']);
    });
  });

  it('uses a single unified prompt (answer / generate SQL / explain) with the driver label', async () => {
    const { service, provider } = createService({ engineLabel: 'MySQL' });
    await service.chat('user-1', 'conn-1', REQ);
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.systemPrompt).toContain('You are a helpful assistant for a MySQL database.');
    expect(opts.systemPrompt).toMatch(/generate SQL/i);
    expect(opts.systemPrompt).toMatch(/explain a SQL query/i);
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

function col(name: string, dataType: string): ColumnMetadata {
  return { name, dataType, nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null };
}

const CHART_COLUMNS: ColumnMetadata[] = [col('status', 'text'), col('count', 'integer')];

const CHART_REQ: ChartSuggestRequest = {
  endpointId: 'ep-1',
  model: 'gpt-4o',
  columns: CHART_COLUMNS,
  sample: [{ status: 'open', count: 3 }],
};

describe('AiService.suggestChart', () => {
  it('returns a validated suggestion parsed from the model JSON', async () => {
    const { service } = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"count","aggregation":"sum"}',
    });
    const result = await service.suggestChart('user-1', 'conn-1', CHART_REQ);
    expect(result).toEqual({ type: 'bar', categoryColumn: 'status', valueColumn: 'count', aggregation: 'sum' });
  });

  it('parses a suggestion embedded in prose/markdown and keeps an explicit aggregation', async () => {
    const { service } = createService({
      providerResponse: 'Sure!\n```json\n{"type":"pie","categoryColumn":"status","valueColumn":"count","aggregation":"avg"}\n```',
    });
    const result = await service.suggestChart('user-1', 'conn-1', CHART_REQ);
    expect(result).toEqual({ type: 'pie', categoryColumn: 'status', valueColumn: 'count', aggregation: 'avg' });
  });

  it('defaults aggregation to "sum" when the model omits or invalidates it', async () => {
    const omitted = createService({ providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"count"}' });
    expect(await omitted.service.suggestChart('user-1', 'conn-1', CHART_REQ)).toEqual({
      type: 'bar', categoryColumn: 'status', valueColumn: 'count', aggregation: 'sum',
    });

    const invalid = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"count","aggregation":"median"}',
    });
    expect(await invalid.service.suggestChart('user-1', 'conn-1', CHART_REQ)).toMatchObject({ aggregation: 'sum' });
  });

  it('returns null when the model names a column that does not exist', async () => {
    const { service } = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"ghost"}',
    });
    expect(await service.suggestChart('user-1', 'conn-1', CHART_REQ)).toBeNull();
  });

  it('returns null for an invalid chart type or unparseable content', async () => {
    const bad = createService({ providerResponse: '{"type":"scatter","categoryColumn":"status","valueColumn":"count"}' });
    expect(await bad.service.suggestChart('user-1', 'conn-1', CHART_REQ)).toBeNull();

    const garbage = createService({ providerResponse: 'no json here' });
    expect(await garbage.service.suggestChart('user-1', 'conn-1', CHART_REQ)).toBeNull();
  });

  it('rejects a model not on the endpoint with BadRequestException', async () => {
    const { service, provider } = createService();
    await expect(
      service.suggestChart('user-1', 'conn-1', { ...CHART_REQ, model: 'gpt-nonexistent' }),
    ).rejects.toThrow(BadRequestException);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('maps a provider failure to ServiceUnavailableException', async () => {
    const { service } = createService({ providerThrows: true });
    await expect(service.suggestChart('user-1', 'conn-1', CHART_REQ)).rejects.toThrow(ServiceUnavailableException);
  });

  it('sends no schema context — only columns + the sample (never buildContext)', async () => {
    const { service, retrieval, provider } = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"count"}',
    });
    await service.suggestChart('user-1', 'conn-1', CHART_REQ);
    expect(retrieval.buildContext).not.toHaveBeenCalled();
    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.systemPrompt).toContain('status');
    expect(opts.systemPrompt).toContain('count');
  });

  it('caps the sample at 15 rows and truncates long values before sending', async () => {
    const { service, provider } = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"count"}',
    });
    const longValue = 'x'.repeat(500);
    const sample = Array.from({ length: 50 }, (_, i) => ({ status: longValue, count: i }));
    await service.suggestChart('user-1', 'conn-1', { ...CHART_REQ, sample });

    const opts = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // The prompt embeds the sanitized sample as JSON; parse it back out to assert the caps.
    const jsonSlice = opts.systemPrompt.slice(opts.systemPrompt.indexOf('['), opts.systemPrompt.indexOf(']') + 1);
    const sent = JSON.parse(jsonSlice) as { status: string }[];
    expect(sent).toHaveLength(15);
    expect(sent[0]!.status.length).toBeLessThanOrEqual(101); // 100 chars + ellipsis
    expect(sent[0]!.status).not.toContain(longValue);
  });
});

function rowsResult(overrides: Partial<RowsStatementResult> = {}): RowsStatementResult {
  return {
    kind: 'rows', sql: 'SELECT id, note FROM t', rows: [], columns: [], totalRows: 0, editable: false, executionTimeMs: 3,
    ...overrides,
  };
}

describe('AiService.runReadQuery', () => {
  it('asserts ownership, runs the read-only query, and returns result + sanitized sample', async () => {
    const result = rowsResult({
      rows: [{ id: 1, note: 'a' }, { id: 2, note: 'b' }],
      columns: [col('id', 'integer'), col('note', 'text')],
      totalRows: 2,
    });
    const { service, connectionsService, queryService } = createService({ runReadOnlyResult: result });

    const res = await service.runReadQuery('user-1', 'conn-1', 'SELECT id, note FROM t', 'corr-9');

    expect(connectionsService.assertOwnership).toHaveBeenCalledWith('user-1', 'conn-1');
    expect(queryService.runReadOnlyQuery).toHaveBeenCalledWith('conn-1', 'SELECT id, note FROM t');
    // Full page for the grid.
    expect(res.result.statements[0]).toBe(result);
    // Sanitized sample: column-major, values preserved for a small result.
    expect(res.sample.columns).toEqual(['id', 'note']);
    expect(res.sample.rows).toEqual([[1, 'a'], [2, 'b']]);
    expect(res.sample.truncated).toBe(false);
  });

  it('caps the sample rows/columns and truncates long cells (model never sees the full result)', async () => {
    const columns = Array.from({ length: 30 }, (_, i) => col(`c${i}`, 'text'));
    const long = 'y'.repeat(500);
    const rows = Array.from({ length: 50 }, () => Object.fromEntries(columns.map((c) => [c.name, long])));
    const { service } = createService({ runReadOnlyResult: rowsResult({ rows, columns, totalRows: 50, truncated: true }) });

    const res = await service.runReadQuery('user-1', 'conn-1', 'SELECT * FROM big');
    expect(res.sample.columns).toHaveLength(20); // col cap
    expect(res.sample.rows).toHaveLength(20); // row cap
    expect(res.sample.truncated).toBe(true);
    expect((res.sample.rows[0]![0] as string).length).toBeLessThanOrEqual(101); // cell cap
    expect(res.sample.rows[0]![0]).not.toBe(long);
  });

  it('propagates the read-only refusal from QueryService (never runs a non-read)', async () => {
    const { service } = createService({ runReadOnlyThrows: new UnprocessableEntityException('not a read') });
    await expect(service.runReadQuery('user-1', 'conn-1', 'DELETE FROM t')).rejects.toThrow(UnprocessableEntityException);
  });
});
