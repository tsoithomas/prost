import { describe, expect, it, vi } from 'vitest';
import type { SchemaObjectSummary } from '@prost/shared-types';
import { openSchemaObject, selectedObjectKey } from './objectNavigation';

function makeStore() {
  return { openTable: vi.fn(), openObject: vi.fn() };
}

describe('openSchemaObject', () => {
  it('routes a view to the grid via openTable (read-only)', () => {
    const store = makeStore();
    const view: SchemaObjectSummary = { kind: 'view', schema: 'public', name: 'active_users' };
    openSchemaObject(store, view);
    expect(store.openTable).toHaveBeenCalledWith('public', 'active_users', 'rows');
    expect(store.openObject).not.toHaveBeenCalled();
  });

  it('routes a materialized view to the grid too', () => {
    const store = makeStore();
    openSchemaObject(store, { kind: 'materializedView', schema: 'public', name: 'mv' });
    expect(store.openTable).toHaveBeenCalledWith('public', 'mv', 'rows');
  });

  it('routes non-relation objects to a definition panel via openObject', () => {
    const store = makeStore();
    openSchemaObject(store, { kind: 'function', schema: 'public', name: 'add' });
    expect(store.openObject).toHaveBeenCalledWith('public', 'function', 'add');
    expect(store.openTable).not.toHaveBeenCalled();
  });

  it('falls back to the "main" schema when the engine has none', () => {
    const store = makeStore();
    openSchemaObject(store, { kind: 'trigger', schema: null, name: 'trg' });
    expect(store.openObject).toHaveBeenCalledWith('main', 'trigger', 'trg');
  });
});

describe('selectedObjectKey', () => {
  it('returns the composite key for an active object tab', () => {
    expect(
      selectedObjectKey({ id: 'object:public.v', label: 'v', kind: 'object', schema: 'public', objectName: 'v' }),
    ).toBe('public.v');
  });

  it('returns null for non-object tabs', () => {
    expect(selectedObjectKey({ id: 'query-1', label: 'Query 1', kind: 'query' })).toBeNull();
    expect(selectedObjectKey(undefined)).toBeNull();
  });
});
