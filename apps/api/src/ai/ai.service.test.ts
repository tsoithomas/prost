import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type {
  ChartSuggestRequest,
  ChatRequest,
  ColumnMetadata,
  QueryPlanResult,
  SchemaSuggestRequest,
  SchemaSuggestionChange,
} from '@prost/shared-types';
import type { ConnectionsService } from '../connections/connections.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { DdlService } from '../ddl/ddl.service';
import type { HistoryService } from '../history/history.service';
import type { AiProviderService } from './ai-provider.service';
import type { DecryptedEndpoint, LlmEndpointService } from './llm-endpoint.service';
import type { RetrievalService } from './retrieval.service';
import type { QueryService } from '../query/query.service';
import type { RowsStatementResult } from '@prost/shared-types';
import {
  AiService,
  MAX_COMMENT_CHARS,
  parseSchemaSuggestions,
  resolveTablesFromSql,
  sanitizePlanForPrompt,
} from './ai.service';

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
  readOnly = false,
  previewSql = 'CREATE INDEX "orders_user_id_idx" ON "public"."orders" USING btree ("user_id")',
  previewThrowsFor,
  listTables = [
    { schema: 'public', name: 'orders' },
    { schema: 'public', name: 'users' },
  ],
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
  readOnly?: boolean;
  previewSql?: string;
  /** Reject `preview` for candidates naming this column — stands in for a hallucination. */
  previewThrowsFor?: string;
  listTables?: { schema: string; name: string }[];
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
    listTables: vi.fn().mockResolvedValue(listTables),
  } as unknown as RetrievalService;

  const pool = {
    driverFor: vi.fn().mockResolvedValue({ descriptor: { label: engineLabel } }),
    assertWritable: vi.fn().mockImplementation(() => {
      if (readOnly) throw new ForbiddenException('This connection is read-only');
      return Promise.resolve();
    }),
    run: vi.fn(),
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

  // Stands in for the real DDL pipeline: renders SQL for a valid candidate, and rejects (as
  // `DdlService.preview` does against live metadata) for one naming `previewThrowsFor`.
  const ddl = {
    preview: vi.fn().mockImplementation((_connectionId: string, req: SchemaSuggestionChange) => {
      if (previewThrowsFor && JSON.stringify(req).includes(previewThrowsFor)) {
        return Promise.reject(
          new UnprocessableEntityException(`Column "${previewThrowsFor}" does not exist`),
        );
      }
      return Promise.resolve({ sql: previewSql });
    }),
  } as unknown as DdlService;

  return {
    service: new AiService(
      connectionsService,
      llmEndpointService,
      provider,
      retrieval,
      pool,
      history,
      queryService,
      ddl,
    ),
    connectionsService,
    llmEndpointService,
    provider,
    retrieval,
    pool,
    history,
    queryService,
    ddl,
  };
}

const EMPTY_ROWS_RESULT: RowsStatementResult = {
  kind: 'rows',
  sql: 'SELECT 1',
  rows: [],
  columns: [],
  totalRows: 0,
  editable: false,
  executionTimeMs: 1,
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
    connectionsService.assertOwnership = vi.fn().mockImplementation(async () => {
      order.push('ownership');
    });
    llmEndpointService.getDecrypted = vi.fn().mockImplementation(async () => {
      order.push('endpoint');
      return ENDPOINT;
    });
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
    await expect(service.chat('user-1', 'conn-1', REQ)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('runs retrieval before the provider call', async () => {
    const { service, retrieval, provider } = createService();
    const order: string[] = [];
    retrieval.buildContext = vi.fn().mockImplementation(async () => {
      order.push('retrieval');
      return SAMPLE_CONTEXT;
    });
    provider.complete = vi.fn().mockImplementation(async () => {
      order.push('provider');
      return 'done';
    });
    await service.chat('user-1', 'conn-1', REQ);
    expect(order).toEqual(['retrieval', 'provider']);
  });
});

function col(name: string, dataType: string): ColumnMetadata {
  return {
    name,
    dataType,
    nullable: true,
    isPrimaryKey: false,
    autoIncrement: false,
    defaultValue: null,
  };
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
      providerResponse:
        '{"type":"bar","categoryColumn":"status","valueColumn":"count","aggregation":"sum"}',
    });
    const result = await service.suggestChart('user-1', 'conn-1', CHART_REQ);
    expect(result).toEqual({
      type: 'bar',
      categoryColumn: 'status',
      valueColumn: 'count',
      aggregation: 'sum',
    });
  });

  it('parses a suggestion embedded in prose/markdown and keeps an explicit aggregation', async () => {
    const { service } = createService({
      providerResponse:
        'Sure!\n```json\n{"type":"pie","categoryColumn":"status","valueColumn":"count","aggregation":"avg"}\n```',
    });
    const result = await service.suggestChart('user-1', 'conn-1', CHART_REQ);
    expect(result).toEqual({
      type: 'pie',
      categoryColumn: 'status',
      valueColumn: 'count',
      aggregation: 'avg',
    });
  });

  it('defaults aggregation to "sum" when the model omits or invalidates it', async () => {
    const omitted = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"count"}',
    });
    expect(await omitted.service.suggestChart('user-1', 'conn-1', CHART_REQ)).toEqual({
      type: 'bar',
      categoryColumn: 'status',
      valueColumn: 'count',
      aggregation: 'sum',
    });

    const invalid = createService({
      providerResponse:
        '{"type":"bar","categoryColumn":"status","valueColumn":"count","aggregation":"median"}',
    });
    expect(await invalid.service.suggestChart('user-1', 'conn-1', CHART_REQ)).toMatchObject({
      aggregation: 'sum',
    });
  });

  it('returns null when the model names a column that does not exist', async () => {
    const { service } = createService({
      providerResponse: '{"type":"bar","categoryColumn":"status","valueColumn":"ghost"}',
    });
    expect(await service.suggestChart('user-1', 'conn-1', CHART_REQ)).toBeNull();
  });

  it('returns null for an invalid chart type or unparseable content', async () => {
    const bad = createService({
      providerResponse: '{"type":"scatter","categoryColumn":"status","valueColumn":"count"}',
    });
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
    await expect(service.suggestChart('user-1', 'conn-1', CHART_REQ)).rejects.toThrow(
      ServiceUnavailableException,
    );
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
    const jsonSlice = opts.systemPrompt.slice(
      opts.systemPrompt.indexOf('['),
      opts.systemPrompt.indexOf(']') + 1,
    );
    const sent = JSON.parse(jsonSlice) as { status: string }[];
    expect(sent).toHaveLength(15);
    expect(sent[0]!.status.length).toBeLessThanOrEqual(101); // 100 chars + ellipsis
    expect(sent[0]!.status).not.toContain(longValue);
  });
});

function rowsResult(overrides: Partial<RowsStatementResult> = {}): RowsStatementResult {
  return {
    kind: 'rows',
    sql: 'SELECT id, note FROM t',
    rows: [],
    columns: [],
    totalRows: 0,
    editable: false,
    executionTimeMs: 3,
    ...overrides,
  };
}

describe('AiService.runReadQuery', () => {
  it('asserts ownership, runs the read-only query, and returns result + sanitized sample', async () => {
    const result = rowsResult({
      rows: [
        { id: 1, note: 'a' },
        { id: 2, note: 'b' },
      ],
      columns: [col('id', 'integer'), col('note', 'text')],
      totalRows: 2,
    });
    const { service, connectionsService, queryService } = createService({
      runReadOnlyResult: result,
    });

    const res = await service.runReadQuery('user-1', 'conn-1', 'SELECT id, note FROM t', 'corr-9');

    expect(connectionsService.assertOwnership).toHaveBeenCalledWith('user-1', 'conn-1');
    expect(queryService.runReadOnlyQuery).toHaveBeenCalledWith('conn-1', 'SELECT id, note FROM t');
    // Full page for the grid.
    expect(res.result.statements[0]).toBe(result);
    // Sanitized sample: column-major, values preserved for a small result.
    expect(res.sample.columns).toEqual(['id', 'note']);
    expect(res.sample.rows).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    expect(res.sample.truncated).toBe(false);
  });

  it('caps the sample rows/columns and truncates long cells (model never sees the full result)', async () => {
    const columns = Array.from({ length: 30 }, (_, i) => col(`c${i}`, 'text'));
    const long = 'y'.repeat(500);
    const rows = Array.from({ length: 50 }, () =>
      Object.fromEntries(columns.map((c) => [c.name, long])),
    );
    const { service } = createService({
      runReadOnlyResult: rowsResult({ rows, columns, totalRows: 50, truncated: true }),
    });

    const res = await service.runReadQuery('user-1', 'conn-1', 'SELECT * FROM big');
    expect(res.sample.columns).toHaveLength(20); // col cap
    expect(res.sample.rows).toHaveLength(20); // row cap
    expect(res.sample.truncated).toBe(true);
    expect((res.sample.rows[0]![0] as string).length).toBeLessThanOrEqual(101); // cell cap
    expect(res.sample.rows[0]![0]).not.toBe(long);
  });

  it('propagates the read-only refusal from QueryService (never runs a non-read)', async () => {
    const { service } = createService({
      runReadOnlyThrows: new UnprocessableEntityException('not a read'),
    });
    await expect(service.runReadQuery('user-1', 'conn-1', 'DELETE FROM t')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});

const SUGGEST_REQ: SchemaSuggestRequest = {
  endpointId: 'ep-1',
  model: 'gpt-4o',
  tables: [{ schema: 'public', table: 'orders' }],
};

/** A model reply proposing one index on `orders.user_id`. */
function indexReply(extra: unknown[] = []): string {
  return JSON.stringify([
    {
      change: {
        kind: 'createIndex',
        request: {
          schema: 'public',
          table: 'orders',
          columns: ['user_id'],
          unique: false,
          method: 'btree',
        },
      },
      rationale: 'The plan sequentially scans orders filtering on user_id, which has no index.',
    },
    ...extra,
  ]);
}

describe('AiService.suggestSchemaChanges (Phase 33)', () => {
  it('returns a typed createIndex suggestion with its server-previewed SQL', async () => {
    const { service, ddl } = createService({ providerResponse: indexReply() });

    const out = await service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ);

    expect(out).toHaveLength(1);
    expect(out[0]!.change).toEqual({
      kind: 'createIndex',
      request: {
        schema: 'public',
        table: 'orders',
        columns: ['user_id'],
        unique: false,
        method: 'btree',
      },
    });
    expect(out[0]!.rationale).toContain('user_id');
    expect(out[0]!.sql).toContain('CREATE INDEX');
    expect(ddl.preview).toHaveBeenCalledWith('conn-1', out[0]!.change);
  });

  it('refuses on a read-only connection before spending anything on the provider', async () => {
    const { service, provider, ddl } = createService({
      readOnly: true,
      providerResponse: indexReply(),
    });

    await expect(service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ)).rejects.toThrow(
      ForbiddenException,
    );
    expect(provider.complete).not.toHaveBeenCalled();
    expect(ddl.preview).not.toHaveBeenCalled();
  });

  it.each([
    ['dropTable', { kind: 'dropTable', request: { schema: 'public', table: 'orders' } }],
    ['truncateTable', { kind: 'truncateTable', request: { schema: 'public', table: 'orders' } }],
    [
      'dropIndex',
      { kind: 'dropIndex', request: { schema: 'public', table: 'orders', index: 'orders_pkey' } },
    ],
    [
      'createTable',
      { kind: 'createTable', request: { schema: 'public', table: 'x', columns: [] } },
    ],
    [
      'alterTable/dropColumn',
      {
        kind: 'alterTable',
        request: {
          schema: 'public',
          table: 'orders',
          operation: { kind: 'dropColumn', column: 'user_id' },
        },
      },
    ],
    [
      'alterTable/dropForeignKey',
      {
        kind: 'alterTable',
        request: {
          schema: 'public',
          table: 'orders',
          operation: { kind: 'dropForeignKey', constraintName: 'fk' },
        },
      },
    ],
    [
      'alterTable/addForeignKey',
      {
        kind: 'alterTable',
        request: {
          schema: 'public',
          table: 'orders',
          operation: {
            kind: 'addForeignKey',
            columns: ['user_id'],
            referencedTable: 'users',
            referencedColumns: ['id'],
          },
        },
      },
    ],
  ])('drops a %s suggestion at the allow-list, never previewing it', async (_label, change) => {
    const { service, ddl } = createService({
      providerResponse: JSON.stringify([{ change, rationale: 'Because I said so.' }]),
    });

    await expect(service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ)).resolves.toEqual(
      [],
    );
    expect(ddl.preview).not.toHaveBeenCalled();
  });

  it('keeps the valid suggestion when a sibling is destructive', async () => {
    const { service } = createService({
      providerResponse: indexReply([
        {
          change: { kind: 'dropTable', request: { schema: 'public', table: 'orders' } },
          rationale: 'This table looks unused.',
        },
      ]),
    });

    const out = await service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ);
    expect(out).toHaveLength(1);
    expect(out[0]!.change.kind).toBe('createIndex');
  });

  it('drops a hallucinated column when preview rejects it, and never executes', async () => {
    const { service, pool } = createService({
      previewThrowsFor: 'nonexistent',
      providerResponse: indexReply([
        {
          change: {
            kind: 'createIndex',
            request: { schema: 'public', table: 'orders', columns: ['nonexistent'], unique: false },
          },
          rationale: 'An index here would help.',
        },
      ]),
    });

    const out = await service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ);

    expect(out).toHaveLength(1);
    expect(out[0]!.change).toMatchObject({ request: { columns: ['user_id'] } });
    expect(pool.run).not.toHaveBeenCalled();
  });

  it('accepts the four suggestable alter operations', async () => {
    const ops = [
      {
        kind: 'addColumn',
        column: { name: 'note', type: 'text', nullable: true, isPrimaryKey: false },
      },
      { kind: 'setNotNull', column: 'user_id', notNull: true },
      { kind: 'setDefault', column: 'status', default: "'new'" },
      { kind: 'changeType', column: 'total', type: 'numeric' },
    ];
    for (const operation of ops) {
      const { service } = createService({
        providerResponse: JSON.stringify([
          {
            change: {
              kind: 'alterTable',
              request: { schema: 'public', table: 'orders', operation },
            },
            rationale: 'A well-grounded reason.',
          },
        ]),
      });
      const out = await service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ);
      expect(out, `operation ${operation.kind} should survive`).toHaveLength(1);
    }
  });

  it('keeps index-only requests inside the existing pipeline while dropping non-index candidates', async () => {
    const alter = {
      change: {
        kind: 'alterTable',
        request: {
          schema: 'public',
          table: 'orders',
          operation: { kind: 'setNotNull', column: 'user_id', notNull: true },
        },
      },
      rationale: 'Not an index.',
    };
    const [index] = JSON.parse(indexReply()) as unknown[];
    const { service, provider, ddl } = createService({
      providerResponse: JSON.stringify([alter, index]),
    });

    const out = await service.suggestSchemaChanges('user-1', 'conn-1', {
      ...SUGGEST_REQ,
      scope: 'indexes',
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.change.kind).toBe('createIndex');
    expect(ddl.preview).toHaveBeenCalledTimes(1);
    const { systemPrompt } = (provider.complete as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(systemPrompt).toContain('index-only request');
  });

  it('grounds the prompt in the requested tables via describeTables', async () => {
    const { service, retrieval } = createService({ providerResponse: indexReply() });
    await service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ);
    expect(retrieval.describeTables).toHaveBeenCalledWith('conn-1', ['public.orders']);
  });

  it('resolves tables from the SQL when the client sends none', async () => {
    const { service, retrieval } = createService({ providerResponse: indexReply() });
    await service.suggestSchemaChanges('user-1', 'conn-1', {
      endpointId: 'ep-1',
      model: 'gpt-4o',
      sql: 'SELECT * FROM orders WHERE user_id = 42',
    });
    expect(retrieval.describeTables).toHaveBeenCalledWith('conn-1', ['public.orders']);
  });

  it('sends no row data: the plan reaches the model without planText, fields, or literals', async () => {
    const { service, provider } = createService({ providerResponse: indexReply() });
    const plan: QueryPlanResult = {
      analyze: true,
      format: 'json',
      executionTimeMs: 12,
      planText: "Seq Scan on orders  (Filter: (email = 'ada@example.com'))",
      root: {
        nodeType: 'Seq Scan',
        detail: "Filter: (email = 'ada@example.com')",
        estimatedCost: 431.2,
        actualRows: 1,
        fields: { 'Secret Field': 'ada@example.com' },
        children: [],
      },
    };

    await service.suggestSchemaChanges('user-1', 'conn-1', { ...SUGGEST_REQ, plan });

    const { systemPrompt } = (provider.complete as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(systemPrompt).not.toContain('ada@example.com');
    expect(systemPrompt).not.toContain('Secret Field');
    expect(systemPrompt).not.toContain('planText');
    expect(systemPrompt).toContain('Seq Scan');
  });

  it('caps the number of suggestions returned', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      change: {
        kind: 'createIndex',
        request: { schema: 'public', table: 'orders', columns: [`c${i}`], unique: false },
      },
      rationale: 'Reason.',
    }));
    const { service } = createService({ providerResponse: JSON.stringify(many) });

    await expect(
      service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ),
    ).resolves.toHaveLength(3);
  });

  it('rejects a model that is not on the endpoint', async () => {
    const { service, provider } = createService();
    await expect(
      service.suggestSchemaChanges('user-1', 'conn-1', { ...SUGGEST_REQ, model: 'other-model' }),
    ).rejects.toThrow(BadRequestException);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('maps a provider failure to ServiceUnavailable', async () => {
    const { service } = createService({ providerThrows: true });
    await expect(service.suggestSchemaChanges('user-1', 'conn-1', SUGGEST_REQ)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('parseSchemaSuggestions', () => {
  it('extracts a JSON array wrapped in prose or a fence', () => {
    const out = parseSchemaSuggestions(
      'Sure!\n```json\n' + indexReply() + '\n```\nHope that helps.',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.change.kind).toBe('createIndex');
  });

  it('returns [] for non-JSON, a non-array, or an empty array', () => {
    expect(parseSchemaSuggestions('I have no suggestions.')).toEqual([]);
    expect(parseSchemaSuggestions('[not json')).toEqual([]);
    expect(parseSchemaSuggestions('[]')).toEqual([]);
  });

  it('drops an entry with a missing or empty rationale', () => {
    const [withChange] = JSON.parse(indexReply()) as { change: unknown }[];
    expect(parseSchemaSuggestions(JSON.stringify([{ change: withChange!.change }]))).toEqual([]);
    expect(
      parseSchemaSuggestions(JSON.stringify([{ change: withChange!.change, rationale: '   ' }])),
    ).toEqual([]);
  });

  it('truncates a rambling rationale', () => {
    const [entry] = JSON.parse(indexReply()) as { change: unknown }[];
    const out = parseSchemaSuggestions(
      JSON.stringify([{ change: entry!.change, rationale: 'x'.repeat(900) }]),
    );
    expect(out[0]!.rationale).toHaveLength(400);
  });

  it('drops a createIndex with no columns', () => {
    const out = parseSchemaSuggestions(
      JSON.stringify([
        {
          change: {
            kind: 'createIndex',
            request: { schema: 'public', table: 'orders', columns: [] },
          },
          rationale: 'Reason.',
        },
      ]),
    );
    expect(out).toEqual([]);
  });

  it('filters otherwise-valid alter changes in index-only scope', () => {
    const content = JSON.stringify([
      {
        change: {
          kind: 'alterTable',
          request: {
            schema: 'public',
            table: 'orders',
            operation: { kind: 'setNotNull', column: 'user_id', notNull: true },
          },
        },
        rationale: 'Not an index.',
      },
      ...(JSON.parse(indexReply()) as unknown[]),
    ]);
    const out = parseSchemaSuggestions(content, 'indexes');
    expect(out).toHaveLength(1);
    expect(out[0]!.change.kind).toBe('createIndex');
  });
});

describe('sanitizePlanForPrompt', () => {
  const plan: QueryPlanResult = {
    analyze: false,
    format: 'json',
    executionTimeMs: 3,
    planText: "Index Cond: (email = 'ada@example.com')",
    root: {
      nodeType: 'Nested Loop',
      detail: 'Join Filter: (o.user_id = u.id)',
      estimatedCost: 100,
      fields: { Output: 'users.email' },
      children: [
        { nodeType: 'Seq Scan', detail: "Filter: (email = 'ada@example.com')", children: [] },
      ],
    },
  };

  it('drops planText and per-node fields entirely', () => {
    const out = sanitizePlanForPrompt(plan);
    expect(out).not.toHaveProperty('planText');
    expect(out.root).not.toHaveProperty('fields');
    expect(JSON.stringify(out)).not.toContain('users.email');
  });

  it('redacts string and numeric literals from detail but keeps the node shape', () => {
    const out = sanitizePlanForPrompt(plan);
    expect(out.root.children[0]!.detail).not.toContain('ada@example.com');
    expect(out.root.children[0]!.detail).toContain("'?'");
    expect(out.root.nodeType).toBe('Nested Loop');
    expect(out.root.estimatedCost).toBe(100);
  });

  it('caps depth so a pathological plan cannot dominate the prompt', () => {
    let node = { nodeType: 'Leaf', children: [] as unknown[] };
    for (let i = 0; i < 40; i += 1) node = { nodeType: `N${i}`, children: [node] };
    const deep = { ...plan, root: node } as unknown as QueryPlanResult;

    let depth = 0;
    let cursor = sanitizePlanForPrompt(deep).root;
    while (cursor.children.length > 0) {
      cursor = cursor.children[0]!;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(12);
  });
});

describe('AiService.describeObject (Phase 38)', () => {
  const req = { endpointId: 'ep-1', model: 'gpt-4o', schema: 'public', table: 'users' };

  it('returns a trimmed draft grounded only in the described table', async () => {
    const { service, retrieval, provider } = createService({
      providerResponse: '  Registered application users.\n',
    });

    const out = await service.describeObject('user-1', 'conn-1', { ...req, column: 'email' });

    expect(out.comment).toBe('Registered application users.');
    expect(retrieval.describeTables).toHaveBeenCalledWith('conn-1', ['public.users']);
    // Schema-only grounding: the prompt is built from the described table, never from rows.
    const [{ systemPrompt }] = (
      provider.complete as unknown as { mock: { calls: [{ systemPrompt: string }][] } }
    ).mock.calls[0]!;
    expect(systemPrompt).toContain('-- described');
    expect(systemPrompt).toContain('the column "email"');
  });

  it('unwraps a quoted or fenced reply and caps its length', async () => {
    const quoted = await createService({
      providerResponse: '"Just a quoted sentence."',
    }).service.describeObject('user-1', 'conn-1', req);
    expect(quoted.comment).toBe('Just a quoted sentence.');

    const fenced = await createService({
      providerResponse: '```\nA fenced sentence.\n```',
    }).service.describeObject('user-1', 'conn-1', req);
    expect(fenced.comment).toBe('A fenced sentence.');

    const long = await createService({ providerResponse: 'x'.repeat(500) }).service.describeObject(
      'user-1',
      'conn-1',
      req,
    );
    expect(long.comment.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
  });

  it('refuses on a read-only connection before spending anything on the provider', async () => {
    const { service, provider } = createService({ readOnly: true });

    await expect(service.describeObject('user-1', 'conn-1', req)).rejects.toThrow(
      ForbiddenException,
    );
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('maps a provider failure to a safe 503', async () => {
    const { service } = createService({ providerThrows: true });
    await expect(service.describeObject('user-1', 'conn-1', req)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('resolveTablesFromSql', () => {
  const all = [
    { schema: 'public', name: 'orders' },
    { schema: 'public', name: 'users' },
    { schema: 'public', name: 'products' },
  ];

  it('matches bare and schema-qualified references, ignoring case', () => {
    expect(
      resolveTablesFromSql('SELECT * FROM Orders o JOIN public.users u ON u.id = o.user_id', all),
    ).toEqual(['public.orders', 'public.users']);
  });

  it('only ever returns tables that actually exist', () => {
    expect(resolveTablesFromSql('SELECT * FROM invented_table', all)).toEqual([]);
  });

  it('does not match a name embedded in a longer identifier', () => {
    expect(resolveTablesFromSql('SELECT * FROM orders_archive', all)).toEqual([]);
  });
});
