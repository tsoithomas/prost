import { afterEach, describe, expect, it } from 'vitest';
import type { QueryResult } from '@prost/shared-types';
import { INITIAL_SQL, useWorkspaceStore } from './workspaceStore';

const initialState = {
  tabs: [{ id: 'query-1', label: 'Query 1', kind: 'query' as const, sql: INITIAL_SQL, result: null }],
  activeTabId: 'query-1',
  pendingQuerySql: null,
  cursorPosition: null,
};

const mockResult: QueryResult = {
  rows: [{ id: 1 }],
  columns: [],
  totalRows: 1,
  editable: false,
  executionTimeMs: 1,
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

  it('targets the active query tab and leaves activeTabId unchanged', () => {
    useWorkspaceStore.getState().newQueryTab();
    const secondTabId = useWorkspaceStore.getState().activeTabId;
    expect(secondTabId).not.toBe('query-1');

    useWorkspaceStore.getState().loadQuery('SELECT 2');
    const state = useWorkspaceStore.getState();
    expect(state.pendingQuerySql).toBe('SELECT 2');
    expect(state.activeTabId).toBe(secondTabId);
  });
});

describe('workspaceStore — newQueryTab', () => {
  it('adds a new query tab with an incrementing label and makes it active', () => {
    useWorkspaceStore.getState().newQueryTab();
    let state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]).toMatchObject({ label: 'Query 2', kind: 'query', sql: INITIAL_SQL, result: null });
    expect(state.activeTabId).toBe(state.tabs[1]!.id);

    useWorkspaceStore.getState().newQueryTab();
    state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(3);
    expect(state.tabs[2]).toMatchObject({ label: 'Query 3', kind: 'query' });
    expect(state.activeTabId).toBe(state.tabs[2]!.id);
  });

  it('generates unique ids across multiple calls', () => {
    useWorkspaceStore.getState().newQueryTab();
    useWorkspaceStore.getState().newQueryTab();
    const ids = useWorkspaceStore.getState().tabs.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('workspaceStore — setTabSql / setTabResult', () => {
  it('setTabSql updates only the target tab', () => {
    useWorkspaceStore.getState().newQueryTab();
    const secondTabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().setTabSql('query-1', 'SELECT 1');
    const state = useWorkspaceStore.getState();
    expect(state.tabs.find((tab) => tab.id === 'query-1')?.sql).toBe('SELECT 1');
    expect(state.tabs.find((tab) => tab.id === secondTabId)?.sql).toBe(INITIAL_SQL);
  });

  it('setTabResult updates only the target tab', () => {
    useWorkspaceStore.getState().newQueryTab();
    const secondTabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().setTabResult('query-1', mockResult);
    const state = useWorkspaceStore.getState();
    expect(state.tabs.find((tab) => tab.id === 'query-1')?.result).toEqual(mockResult);
    expect(state.tabs.find((tab) => tab.id === secondTabId)?.result).toBeNull();
  });
});

describe('workspaceStore — closeTab with multiple query tabs', () => {
  it('removes the closed tab and falls back to the remaining query tab', () => {
    useWorkspaceStore.getState().newQueryTab();
    const secondTabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().closeTab(secondTabId);
    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.id).toBe('query-1');
    expect(state.activeTabId).toBe('query-1');
  });
});
