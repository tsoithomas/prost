import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { ChatPanel } from './ChatPanel';
import { ApiError } from '../lib/apiClient';

const {
  mockStream,
  mockRunMutateAsync,
  mockLoadQuery,
  mockFetchConversation,
  conversationsBox,
  runResult,
} = vi.hoisted(() => ({
  // Drives an assistant reply that proposes a read-only query, then resolves.
  mockStream: vi.fn((_conn: string, _req: unknown, handlers: { onDelta: (d: string) => void }) => {
    handlers.onDelta('To find that, run:\n\n```sql\nSELECT * FROM users\n```');
    return Promise.resolve();
  }),
  mockRunMutateAsync: vi.fn(),
  mockLoadQuery: vi.fn(),
  mockFetchConversation: vi.fn(),
  // Mutable so a test can seed the "latest conversation" the panel should auto-resume.
  conversationsBox: { list: [] as { id: string }[] },
  runResult: {
    sql: 'SELECT * FROM users',
    result: { statements: [], transactional: false, statementCount: 0 },
    sample: { columns: ['id'], rows: [[1]], truncated: false },
  },
}));

vi.mock('../api/ai', () => ({
  streamAiChat: mockStream,
  useRunReadQuery: () => ({ mutateAsync: mockRunMutateAsync, isPending: false }),
  useLlmEndpoints: () => ({
    data: [{ id: 'ep1', name: 'E', baseUrl: '', models: ['m1'], hasApiKey: true, contextBudget: null, maxOutputTokens: null, createdAt: '' }],
    isLoading: false,
  }),
  useConversations: () => ({ data: conversationsBox.list }),
  useAppendConversation: () => ({ mutate: vi.fn() }),
  useDeleteConversation: () => ({ mutate: vi.fn() }),
  fetchConversation: mockFetchConversation,
}));

const aiState = {
  selectedEndpointId: 'ep1',
  selectedModel: 'm1',
  setSelection: vi.fn(),
  pendingChatPrompt: null,
  clearPendingChatPrompt: vi.fn(),
  autoRunReadQueries: false,
  setAutoRunReadQueries: vi.fn(),
  rightSidebarOpen: true,
};
vi.mock('../stores/aiStore', () => ({
  useAiStore: Object.assign((sel: (s: typeof aiState) => unknown) => sel(aiState), { getState: () => aiState }),
}));

const wsState = {
  loadQuery: mockLoadQuery,
  tabs: [{ id: 'q1', kind: 'query', sql: '' }],
  activeTabId: 'q1',
};
vi.mock('../stores/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: typeof wsState) => unknown) => sel(wsState),
}));

// The endpoints-management modal pulls its own CRUD hooks from ../api/ai; stub it (we mock the module).
vi.mock('./LlmEndpointsModal', () => ({ LlmEndpointsModal: () => null }));

afterEach(() => {
  vi.clearAllMocks();
  aiState.autoRunReadQueries = false;
  conversationsBox.list = [];
});

async function sendAndWaitForProposal() {
  renderWithProviders(<ChatPanel connectionId="conn-1" />);
  await userEvent.type(screen.getByRole('textbox'), 'how many users?');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  return screen.findByRole('button', { name: /run \(read-only\)/i });
}

describe('ChatPanel — agentic read (Phase 31)', () => {
  it('shows a "Run (read-only)" button on a proposed SELECT and feeds results back inline on click', async () => {
    mockRunMutateAsync.mockResolvedValue(runResult);
    const runBtn = await sendAndWaitForProposal();

    await userEvent.click(runBtn);

    expect(mockRunMutateAsync).toHaveBeenCalledWith({ sql: 'SELECT * FROM users' });
    // The sanitized sample is fed back as a new turn so the model answers inline. The feed-back turn is
    // plain text with NO ``` fences (user messages render raw, not markdown) — and no grid is opened.
    await waitFor(() => expect(mockStream.mock.calls.length).toBeGreaterThanOrEqual(2));
    const feedReq = mockStream.mock.calls[1]![1] as { messages: { role: string; content: string }[] };
    // History is preserved: the original question + the assistant's SQL proposal are still there, and
    // the feed-back turn is appended (not replacing them) — plain text, no ``` fences.
    expect(feedReq.messages[0]).toEqual({ role: 'user', content: 'how many users?' });
    expect(feedReq.messages.some((m) => m.role === 'assistant' && m.content.includes('SELECT * FROM users'))).toBe(true);
    const lastMsg = feedReq.messages[feedReq.messages.length - 1]!;
    expect(lastMsg.content).toContain('"columns"');
    expect(lastMsg.content).not.toContain('```');
  });

  it('surfaces a refusal when the server rejects the statement (422) and does not feed back', async () => {
    mockRunMutateAsync.mockRejectedValue(new ApiError(422, 'VALIDATION_ERROR', 'Only read-only SELECT statements can be run', 'c1'));
    const runBtn = await sendAndWaitForProposal();

    await userEvent.click(runBtn);

    await waitFor(() => expect(screen.getByText(/only read-only select/i)).toBeInTheDocument());
    expect(mockStream).toHaveBeenCalledTimes(1); // only the original ask streamed; no results turn
  });

  it('auto-runs the proposed query when the toggle is on (no click)', async () => {
    aiState.autoRunReadQueries = true;
    mockRunMutateAsync.mockResolvedValue(runResult);

    renderWithProviders(<ChatPanel connectionId="conn-1" />);
    await userEvent.type(screen.getByRole('textbox'), 'how many users?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockRunMutateAsync).toHaveBeenCalledWith({ sql: 'SELECT * FROM users' }));
    // Results are fed back automatically (a second stream), still with no grid + no fences.
    await waitFor(() => expect(mockStream.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe('ChatPanel — resume latest conversation', () => {
  it('auto-loads the most recent conversation into an empty panel', async () => {
    conversationsBox.list = [{ id: 'convo-latest' }, { id: 'convo-older' }];
    mockFetchConversation.mockResolvedValue({
      id: 'convo-latest',
      messages: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ],
    });

    renderWithProviders(<ChatPanel connectionId="conn-1" />);

    // The newest conversation (first in the list) is fetched and its messages rendered.
    await waitFor(() => expect(mockFetchConversation).toHaveBeenCalledWith('conn-1', 'convo-latest'));
    expect(await screen.findByText('earlier question')).toBeInTheDocument();
    expect(screen.getByText('earlier answer')).toBeInTheDocument();
  });
});
