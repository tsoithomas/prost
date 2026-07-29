import { beforeEach, describe, expect, it } from 'vitest';
import type { SchemaSuggestionChange } from '@prost/shared-types';
import { useDdlStore } from './ddlStore';

const CHANGE: SchemaSuggestionChange = {
  kind: 'createIndex',
  request: { schema: 'public', table: 'orders', columns: ['user_id'], unique: false },
};

describe('ddlStore', () => {
  beforeEach(() => {
    useDdlStore.setState({ pending: null });
  });

  it('starts with nothing pending', () => {
    expect(useDdlStore.getState().pending).toBeNull();
  });

  it('holds the handed-over change until closed', () => {
    useDdlStore.getState().openDdl({
      connectionId: 'conn-1',
      schema: 'public',
      table: 'orders',
      change: CHANGE,
    });
    expect(useDdlStore.getState().pending).toEqual({
      connectionId: 'conn-1',
      schema: 'public',
      table: 'orders',
      change: CHANGE,
    });

    useDdlStore.getState().closeDdl();
    expect(useDdlStore.getState().pending).toBeNull();
  });

  it('replaces an earlier pending change rather than queueing', () => {
    const store = useDdlStore.getState();
    store.openDdl({ connectionId: 'c', schema: 's', table: 'a', change: CHANGE });
    store.openDdl({ connectionId: 'c', schema: 's', table: 'b', change: CHANGE });
    expect(useDdlStore.getState().pending?.table).toBe('b');
  });
});
