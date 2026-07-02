import { afterEach, describe, expect, it } from 'vitest';
import type { ExecuteQueryResponse } from '@prost/shared-types';
import { INITIAL_SQL, useWorkspaceStore } from './workspaceStore';

const initialState = {
  tabs: [{ id: 'query-1', label: 'Query 1', kind: 'query' as const, sql: INITIAL_SQL, result: null }],
  activeTabId: 'query-1',
  pendingQuerySql: null,
  cursorPosition: null,
};

const mockResult: ExecuteQueryResponse = {
  statements: [{ kind: 'rows', sql: 'SELECT 1', rows: [{ id: 1 }], columns: [], totalRows: 1, editable: false, executionTimeMs: 1 }],
  transactional: false,
  statementCount: 1,
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

describe('workspaceStore — openOverview', () => {
  it('opens an overview tab keyed by schema and makes it active', () => {
    useWorkspaceStore.getState().openOverview('public');
    const state = useWorkspaceStore.getState();
    expect(state.activeTabId).toBe('overview:public');
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]).toMatchObject({ id: 'overview:public', kind: 'overview', schema: 'public', label: 'public' });
  });

  it('dedupes: reopening the same schema reactivates the existing tab', () => {
    useWorkspaceStore.getState().openOverview('public');
    useWorkspaceStore.getState().openTable('public', 'users');
    useWorkspaceStore.getState().openOverview('public');
    const state = useWorkspaceStore.getState();
    expect(state.tabs.filter((t) => t.id === 'overview:public')).toHaveLength(1);
    expect(state.activeTabId).toBe('overview:public');
  });
});

describe('workspaceStore — openTable search hand-off / closeTableTab', () => {
  it('stashes the search term on the tab and clearTabSearch removes it', () => {
    useWorkspaceStore.getState().openTable('public', 'users', 'rows', { search: '' });
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === 'table:public.users')?.search).toBe('');

    useWorkspaceStore.getState().clearTabSearch('table:public.users');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === 'table:public.users')?.search).toBeUndefined();
  });

  it('closeTableTab removes the matching table tab and is a no-op when absent', () => {
    useWorkspaceStore.getState().openTable('public', 'users');
    useWorkspaceStore.getState().closeTableTab('public', 'users');
    expect(useWorkspaceStore.getState().tabs.some((t) => t.id === 'table:public.users')).toBe(false);

    const before = useWorkspaceStore.getState().tabs.map((t) => t.id);
    useWorkspaceStore.getState().closeTableTab('public', 'ghost');
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(before);
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

  it('setTabTransactional updates only the target tab, defaulting to falsy on a fresh tab', () => {
    useWorkspaceStore.getState().newQueryTab();
    const secondTabId = useWorkspaceStore.getState().activeTabId;

    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === 'query-1')?.transactional).toBeFalsy();

    useWorkspaceStore.getState().setTabTransactional('query-1', true);
    const state = useWorkspaceStore.getState();
    expect(state.tabs.find((tab) => tab.id === 'query-1')?.transactional).toBe(true);
    expect(state.tabs.find((tab) => tab.id === secondTabId)?.transactional).toBeFalsy();
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

describe('workspaceStore — reorderTab', () => {
  it('moves a tab to the target position, preserving the active tab', () => {
    const store = useWorkspaceStore.getState();
    store.openTable('public', 'users'); // table:public.users
    store.newQueryTab(); // a 3rd tab
    const ids = useWorkspaceStore.getState().tabs.map((t) => t.id);
    expect(ids).toEqual(['query-1', 'table:public.users', ids[2]]);

    // Drag the last tab onto the first position.
    useWorkspaceStore.getState().reorderTab(ids[2]!, 'query-1');
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual([ids[2], 'query-1', 'table:public.users']);
    expect(useWorkspaceStore.getState().activeTabId).toBe(ids[2]); // unchanged
  });

  it('is a no-op when dragged onto itself or an unknown id', () => {
    useWorkspaceStore.getState().openTable('public', 'users');
    const before = useWorkspaceStore.getState().tabs.map((t) => t.id);
    useWorkspaceStore.getState().reorderTab('query-1', 'query-1');
    useWorkspaceStore.getState().reorderTab('nope', 'query-1');
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(before);
  });
});

describe('workspaceStore — bulk close', () => {
  // newQueryTab generates a `query-<uuid>` id (only the label is "Query 2"), so capture it.
  function seed() {
    const store = useWorkspaceStore.getState();
    store.openTable('public', 'a'); // table:public.a
    store.openTable('public', 'b'); // table:public.b
    store.newQueryTab();
    const ids = useWorkspaceStore.getState().tabs.map((t) => t.id); // [query-1, t:a, t:b, query-<uuid>]
    return { ids, query2: ids[3]! };
  }

  it('closeOtherTabs keeps only the target (and a surviving query tab)', () => {
    seed();
    useWorkspaceStore.getState().closeOtherTabs('table:public.a');
    // Target table tab kept; since no query tab would survive, the first query tab is retained.
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['query-1', 'table:public.a']);
  });

  it('closeTabsToLeft removes tabs before the target', () => {
    const { query2 } = seed();
    useWorkspaceStore.getState().closeTabsToLeft('table:public.b');
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['table:public.b', query2]);
  });

  it('closeTabsToRight removes tabs after the target', () => {
    seed();
    useWorkspaceStore.getState().closeTabsToRight('table:public.a');
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['query-1', 'table:public.a']);
  });

  it('closeAllTableTabs removes every table tab but keeps all query tabs', () => {
    const { query2 } = seed();
    useWorkspaceStore.getState().closeAllTableTabs();
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['query-1', query2]);
  });

  it('repoints activeTabId when the active tab is closed', () => {
    const { query2 } = seed();
    useWorkspaceStore.getState().selectTab('table:public.b');
    useWorkspaceStore.getState().closeAllTableTabs();
    const state = useWorkspaceStore.getState();
    expect(state.tabs.some((t) => t.id === state.activeTabId)).toBe(true);
    expect(state.activeTabId).toBe(query2);
  });
});
