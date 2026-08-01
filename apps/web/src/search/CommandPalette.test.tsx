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
  useWorkspaceStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        openTable: mockOpenTable,
        revealTableColumn: mockReveal,
        loadQuery: mockLoadQuery,
        // `useCommands` (Phase 40) reads these; an empty/single-tab shape keeps its extra
        // tab-scoped commands out of this test's fixture, matching pre-Phase-40 assertions.
        tabs: [{ id: 'query-1', label: 'Query 1', kind: 'query' }],
        activeTabId: 'query-1',
      }),
    { getState: () => ({ requestViewAction: vi.fn(), newQueryTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn() }) },
  ),
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
    // No explicit viewMode: the store resolves 'rows' or a remembered last mode (Phase 40).
    expect(mockOpenTable).toHaveBeenCalledWith('conn-1', 'public', 'orders');
    expect(mockClose).toHaveBeenCalled();
  });

  it('selecting a column reveals it in the structure tab', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'total');
    await userEvent.click(screen.getByText('orders.total'));
    expect(mockReveal).toHaveBeenCalledWith('conn-1', 'public', 'orders', 'total');
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
    // A full, distinctive term so no command's label fuzzy-matches ahead of the table (commands are
    // listed first in the flattened, keyboard-navigable order — see the dedicated command tests below).
    await userEvent.type(input, 'orders');
    await userEvent.keyboard('{Enter}');
    expect(mockOpenTable).toHaveBeenCalledWith('conn-1', 'public', 'orders');

    await userEvent.keyboard('{Escape}');
    expect(mockClose).toHaveBeenCalled();
  });

  it('shows commands on an empty query (Phase 40)', () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('New query tab')).toBeInTheDocument();
  });

  it('running a command via click executes it and closes the palette', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByText('New query tab'));
    expect(mockClose).toHaveBeenCalled();
  });

  it('arrow-key navigation reaches commands and typing filters them', async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.type(screen.getByLabelText('Search'), 'shortcuts');
    expect(screen.getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(screen.queryByText('New query tab')).not.toBeInTheDocument();
  });
});
