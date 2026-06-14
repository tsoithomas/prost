import { afterEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

const initialState = {
  tabs: [{ id: 'query-1', label: 'Query 1', kind: 'query' as const }],
  activeTabId: 'query-1',
  pendingQuerySql: null,
  cursorPosition: null,
};

afterEach(() => {
  useWorkspaceStore.setState(initialState);
});

describe('workspaceStore — loadQuery', () => {
  it('sets pendingQuerySql to the given SQL', () => {
    useWorkspaceStore.getState().loadQuery('SELECT 1');
    expect(useWorkspaceStore.getState().pendingQuerySql).toBe('SELECT 1');
  });

  it('switches activeTabId to the first query tab even when a table tab is active', () => {
    useWorkspaceStore.getState().openTable('public', 'users');
    expect(useWorkspaceStore.getState().activeTabId).toBe('table:public.users');

    useWorkspaceStore.getState().loadQuery('SELECT * FROM users');
    expect(useWorkspaceStore.getState().activeTabId).toBe('query-1');
  });

  it('does not execute — only sets pendingQuerySql with no additional side-effects', () => {
    useWorkspaceStore.getState().loadQuery('DROP TABLE users');
    const state = useWorkspaceStore.getState();
    expect(state.pendingQuerySql).toBe('DROP TABLE users');
    expect(state.activeTabId).toBe('query-1');
  });

  it('clearPendingQuerySql resets pendingQuerySql to null', () => {
    useWorkspaceStore.getState().loadQuery('SELECT 1');
    expect(useWorkspaceStore.getState().pendingQuerySql).toBe('SELECT 1');
    useWorkspaceStore.getState().clearPendingQuerySql();
    expect(useWorkspaceStore.getState().pendingQuerySql).toBeNull();
  });
});
