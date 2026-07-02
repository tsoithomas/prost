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
