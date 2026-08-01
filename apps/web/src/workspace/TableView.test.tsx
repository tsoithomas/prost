import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { TableView } from './TableView';
import { renderWithProviders } from '../test/renderWithProviders';
import { useWorkspaceStore } from '../stores/workspaceStore';

// AG Grid is heavy and not needed to exercise the toolbar/keyboard-shortcut logic under test —
// `onGridKeyDown` and the search box live on TableView's own wrapper div, not inside the grid.
vi.mock('ag-grid-react', () => ({ AgGridReact: () => <div data-testid="grid" /> }));
vi.mock('../grid/columnDefs', () => ({ buildColumnDefs: () => [] }));

vi.mock('../lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/apiClient')>('../lib/apiClient');
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({
      columns: [{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: true, defaultValue: null }],
      rows: [],
      totalRows: 0,
      editable: true,
      primaryKey: ['id'],
      concurrency: 'preimage',
    }),
  };
});

vi.mock('../api/connections', () => ({
  useConnection: () => ({ capabilities: { readOnly: false } }),
}));
vi.mock('../api/grid', () => ({
  useBulkUpdate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRow: () => ({ mutateAsync: vi.fn() }),
  useInsertRow: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../api/preferences', () => ({
  useUpdatePreferences: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));
vi.mock('../hooks/useToasts', () => ({
  useToasts: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

function renderTable() {
  return renderWithProviders(
    <TableView connectionId="conn-1" schema="public" table="users" viewMode="rows" onViewModeChange={vi.fn()} />,
  );
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ viewActionRequest: null });
});

describe('TableView — keyboard shortcuts (Phase 40)', () => {
  it('mod+f focuses the cross-column search box', async () => {
    renderTable();
    const gridWrapper = (await screen.findByTestId('grid')).parentElement!;
    const searchInput = screen.getByLabelText('Search all columns');
    expect(document.activeElement).not.toBe(searchInput);

    fireEvent.keyDown(gridWrapper, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(searchInput);
  });
});

describe('TableView — refresh feedback (Phase 40)', () => {
  it('spins the refresh icon for a minimum visible duration', async () => {
    renderTable();
    await screen.findByTestId('grid');
    const refreshButton = screen.getByRole('button', { name: 'Refresh rows' });
    const icon = refreshButton.querySelector('svg')!;
    expect(icon).not.toHaveClass('animate-spin');

    fireEvent.click(refreshButton);
    expect(icon).toHaveClass('animate-spin');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(icon).not.toHaveClass('animate-spin');
  });

  it('spins via the store-level view-action hand-off (the path the global Alt+R shortcut and the command palette both use)', async () => {
    // refresh-view used to be handled inside this component's own grid-scoped onGridKeyDown, which
    // only fired when focus already happened to be inside the grid wrapper. It's dispatched globally
    // now (see AppLayout), landing here via `requestViewAction` — this is the actual code path that
    // now runs for both the keyboard shortcut and the command palette's "Refresh current view".
    renderTable();
    await screen.findByTestId('grid');
    const refreshButton = screen.getByRole('button', { name: 'Refresh rows' });
    const icon = refreshButton.querySelector('svg')!;
    expect(icon).not.toHaveClass('animate-spin');

    act(() => {
      useWorkspaceStore.getState().requestViewAction('refresh');
    });
    expect(icon).toHaveClass('animate-spin');
  });
});
