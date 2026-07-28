import { beforeEach, describe, expect, it } from 'vitest';
import { useAiStore } from './aiStore';

describe('aiStore chat hand-off', () => {
  beforeEach(() => {
    useAiStore.setState({ rightSidebarOpen: false, pendingChatPrompt: null });
  });

  it('sendToChat queues the prompt and opens the AI panel', () => {
    useAiStore.getState().sendToChat('This query failed: ...');

    expect(useAiStore.getState().pendingChatPrompt).toBe('This query failed: ...');
    expect(useAiStore.getState().rightSidebarOpen).toBe(true);
  });

  it('clearPendingChatPrompt clears the queued prompt without closing the panel', () => {
    useAiStore.getState().sendToChat('x');
    useAiStore.getState().clearPendingChatPrompt();

    expect(useAiStore.getState().pendingChatPrompt).toBeNull();
    expect(useAiStore.getState().rightSidebarOpen).toBe(true);
  });
});

describe('aiStore auto-run toggle (Phase 31)', () => {
  beforeEach(() => useAiStore.setState({ autoRunReadQueries: false }));

  it('defaults off and toggles', () => {
    expect(useAiStore.getState().autoRunReadQueries).toBe(false);
    useAiStore.getState().setAutoRunReadQueries(true);
    expect(useAiStore.getState().autoRunReadQueries).toBe(true);
    useAiStore.getState().setAutoRunReadQueries(false);
    expect(useAiStore.getState().autoRunReadQueries).toBe(false);
  });

  it('is persisted across reloads', () => {
    useAiStore.getState().setAutoRunReadQueries(true);
    const persisted = JSON.parse(localStorage.getItem('prost-ai') ?? '{}') as { state?: Record<string, unknown> };
    expect(persisted.state?.autoRunReadQueries).toBe(true);
  });
});
