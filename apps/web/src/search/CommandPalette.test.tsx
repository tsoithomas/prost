import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryHistoryDto, SchemaMetadata, SnippetDto } from '@prost/shared-types';
import { CommandPalette } from './CommandPalette';
import { renderWithProviders } from '../test/renderWithProviders';

const mockClose = vi.fn();
const mockOpenTable = vi.fn();
const mockReveal = vi.fn();
const mockLoadQuery = vi.fn();

function column(name: string) {
  return { name, dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null };
}

const schemas: SchemaMetadata[] = [
  {
    name: 'public',
    tables: [{ schema: 'public', name: 'orders', columns: [column('id'), column('total')] }],
    objects: [],
  },
];

const snippets: SnippetDto[] = [
  { id: 's1', name: 'orders report', body: 'SELECT * FROM orders', createdAt: '', updatedAt: '' },
];

const history: QueryHistoryDto[] = [
  {
    id: 'h1',
    connectionId: 'conn-1',
    connectionName: 'Local',
    sql: 'SELECT count(*) FROM orders',
    executedAt: '2026-01-01T00:00:00.000Z',
    starred: false,
  },
];

vi.mock('../stores/commandPaletteStore', () => ({
  useCommandPaletteStore: (selector: (s: unknown) => unknown) =>
    selector({ open: true, openPalette: vi.fn(), closePalette: mockClose, toggle: vi.fn() }),
}));
vi.mock('../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: unknown) => unknown) =>
    selector({ openTable: mockOpenTable, revealTableColumn: mockReveal, loadQuery: mockLoadQuery }),
}));
vi.mock('../stores/connectionStore', () => ({
  useConnectionStore: (selector: (s: unknown) => unknown) => selector({ activeConnectionId: 'conn-1' }),
}));
vi.mock('../api/metadata', () => ({ useMetadata: () => ({ data: schemas }) }));
vi.mock('../api/snippets', () => ({ useSnippets: () => ({ data: snippets }) }));
vi.mock('../api/history', () => ({ useHistorySearch: () => ({ data: history }) }));
vi.mock('../hooks/useMediaQuery', () => ({ useIsMobile: () => false }));
vi.mock('../hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: unknown) => v }));

afterEach(() => vi.clearAllMocks());

describe('CommandPalette', () => {
  it('groups matching tables, snippets, and history as you type', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'ord');
    expect(screen.getByText('Tables')).toBeInTheDocument();
    expect(screen.getByText('Snippets')).toBeInTheDocument();
    expect(screen.getByText('orders report')).toBeInTheDocument();
  });

  it('selecting a table opens its rows tab', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'ord');
    await userEvent.click(screen.getByText('orders', { exact: true }));
    expect(mockOpenTable).toHaveBeenCalledWith('public', 'orders', 'rows');
    expect(mockClose).toHaveBeenCalled();
  });

  it('selecting a column reveals it in the structure tab', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'total');
    await userEvent.click(screen.getByText('orders.total'));
    expect(mockReveal).toHaveBeenCalledWith('public', 'orders', 'total');
  });

  it('selecting a snippet loads its body without running', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'report');
    await userEvent.click(screen.getByText('orders report'));
    expect(mockLoadQuery).toHaveBeenCalledWith('SELECT * FROM orders');
  });

  it('selecting a history entry loads its SQL without running', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'count');
    await userEvent.click(screen.getByText('SELECT count(*) FROM orders'));
    expect(mockLoadQuery).toHaveBeenCalledWith('SELECT count(*) FROM orders');
  });

  it('Enter selects the active result; Escape closes', async () => {
    renderWithProviders(<CommandPalette />);
    const input = screen.getByLabelText('Search');
    await userEvent.type(input, 'ord');
    await userEvent.keyboard('{Enter}');
    expect(mockOpenTable).toHaveBeenCalledWith('public', 'orders', 'rows');

    await userEvent.keyboard('{Escape}');
    expect(mockClose).toHaveBeenCalled();
  });
});
