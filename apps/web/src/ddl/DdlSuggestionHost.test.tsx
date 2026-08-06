import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { SchemaDiffChange } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { useDdlStore } from '../stores/ddlStore';
import { DdlSuggestionHost } from './DdlSuggestionHost';

const COLUMNS = [
  { name: 'user_id', dataType: 'integer', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

const { mockStructure } = vi.hoisted(() => ({ mockStructure: vi.fn() }));

vi.mock('../api/metadata', () => ({ useTableStructure: mockStructure }));

// Stub the real modals: this host's job is routing + prop wiring, which is what we assert.
vi.mock('./CreateIndexModal', () => ({
  CreateIndexModal: (props: Record<string, unknown>) => (
    <div data-testid="create-index" data-props={JSON.stringify(props)} />
  ),
}));
vi.mock('./CreateTableModal', () => ({
  CreateTableModal: (props: Record<string, unknown>) => (
    <div data-testid="create-table" data-props={JSON.stringify(props)} />
  ),
}));
vi.mock('./AddColumnModal', () => ({
  AddColumnModal: (props: Record<string, unknown>) => (
    <div data-testid="add-column" data-props={JSON.stringify(props)} />
  ),
}));
vi.mock('./AddForeignKeyModal', () => ({
  AddForeignKeyModal: (props: Record<string, unknown>) => (
    <div data-testid="add-foreign-key" data-props={JSON.stringify(props)} />
  ),
}));
vi.mock('./EditColumnModal', () => ({
  EditColumnModal: (props: Record<string, unknown>) => (
    <div data-testid="edit-column" data-props={JSON.stringify(props)} />
  ),
}));

function open(change: SchemaDiffChange) {
  useDdlStore.getState().openDdl({
    connectionId: 'conn-1',
    schema: 'public',
    table: 'orders',
    change,
  });
}

function propsOf(testId: string): Record<string, unknown> {
  return JSON.parse(screen.getByTestId(testId).getAttribute('data-props') ?? '{}');
}

describe('DdlSuggestionHost', () => {
  beforeEach(() => {
    useDdlStore.setState({ pending: null });
    mockStructure.mockReturnValue({ data: { columns: COLUMNS, indexes: [], foreignKeys: [] } });
  });

  it('renders nothing when no change is pending', () => {
    const { container } = renderWithProviders(<DdlSuggestionHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the structure query disabled while idle', () => {
    renderWithProviders(<DdlSuggestionHost />);
    expect(mockStructure).toHaveBeenCalledWith(null, '', '');
  });

  it('routes createIndex to CreateIndexModal, pre-filled', () => {
    open({
      kind: 'createIndex',
      request: { schema: 'public', table: 'orders', columns: ['user_id'], unique: true, method: 'btree' },
    });
    renderWithProviders(<DdlSuggestionHost />);

    const props = propsOf('create-index');
    expect(props['open']).toBe(true);
    expect(props['schema']).toBe('public');
    expect(props['table']).toBe('orders');
    expect(props['initialColumns']).toEqual(['user_id']);
    expect(props['initialUnique']).toBe(true);
    expect(props['initialMethod']).toBe('btree');
  });

  it('routes an addColumn operation to AddColumnModal, pre-filled', () => {
    const column = { name: 'note', type: 'text', nullable: true, isPrimaryKey: false };
    open({
      kind: 'alterTable',
      request: { schema: 'public', table: 'orders', operation: { kind: 'addColumn', column } },
    });
    renderWithProviders(<DdlSuggestionHost />);

    expect(propsOf('add-column')['initialColumn']).toEqual(column);
  });

  it.each(['setNotNull', 'setDefault', 'changeType'] as const)(
    'routes a %s operation to EditColumnModal with the targeted column',
    (kind) => {
      const operation = {
        setNotNull: { kind: 'setNotNull', column: 'user_id', notNull: true },
        setDefault: { kind: 'setDefault', column: 'user_id', default: '0' },
        changeType: { kind: 'changeType', column: 'user_id', type: 'bigint' },
      }[kind];
      open({
        kind: 'alterTable',
        request: { schema: 'public', table: 'orders', operation },
      } as SchemaDiffChange);
      renderWithProviders(<DdlSuggestionHost />);

      const props = propsOf('edit-column');
      expect((props['col'] as { name: string }).name).toBe('user_id');
      expect(props['initialOperation']).toEqual(operation);
    },
  );

  it('waits for the structure before rendering an edit it cannot resolve a column for', () => {
    mockStructure.mockReturnValue({ data: undefined });
    open({
      kind: 'alterTable',
      request: { schema: 'public', table: 'orders', operation: { kind: 'setNotNull', column: 'user_id', notNull: true } },
    });
    const { container } = renderWithProviders(<DdlSuggestionHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it('routes createTable to CreateTableModal, pre-filled (a schema-diff migration change)', () => {
    const columns = [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false }];
    open({ kind: 'createTable', request: { schema: 'public', table: 'orders', columns } });
    renderWithProviders(<DdlSuggestionHost />);

    const props = propsOf('create-table');
    expect(props['initialSchema']).toBe('public');
    expect(props['schemas']).toEqual(['public']);
    expect(props['initialTable']).toBe('orders');
    expect(props['initialColumns']).toEqual(columns);
  });

  it('routes an addForeignKey operation to AddForeignKeyModal, pre-filled (a schema-diff migration change)', () => {
    const operation = {
      kind: 'addForeignKey' as const,
      columns: ['user_id'],
      referencedSchema: 'public',
      referencedTable: 'users',
      referencedColumns: ['id'],
    };
    open({ kind: 'alterTable', request: { schema: 'public', table: 'orders', operation } });
    renderWithProviders(<DdlSuggestionHost />);

    const props = propsOf('add-foreign-key');
    expect(props['initialOperation']).toEqual(operation);
    expect(props['availableColumns']).toEqual(COLUMNS);
  });

  it.each(['dropTable', 'dropIndex'] as const)('renders nothing for a %s change — applied directly, never routed here', (kind) => {
    open(
      kind === 'dropTable'
        ? { kind: 'dropTable', request: { schema: 'public', table: 'orders' } }
        : { kind: 'dropIndex', request: { schema: 'public', table: 'orders', index: 'orders_idx' } },
    );
    const { container } = renderWithProviders(<DdlSuggestionHost />);
    expect(container).toBeEmptyDOMElement();
  });
});
