import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryHistoryDto } from '@prost/shared-types';
import { QueryHistoryList } from './QueryHistoryList';
import { renderWithProviders } from '../test/renderWithProviders';

const mockUpdateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
const mockClearMutate = vi.fn();
const mockExportMutate = vi.fn();
const mockConfirm = vi.fn();
const searchCalls: { connectionId: string | null; search: string; enabled?: boolean }[] = [];

const entry: QueryHistoryDto = {
  id: 'hist-1',
  connectionId: 'conn-1',
  connectionName: 'Local PG',
  sql: 'SELECT * FROM users',
  executedAt: '2026-01-01T00:00:00.000Z',
  starred: false,
};

vi.mock('../api/history', () => ({
  useHistorySearch: (params: { connectionId: string | null; search: string; enabled?: boolean }) => {
    searchCalls.push(params);
    return { data: [entry], isLoading: false, isError: false };
  },
  useUpdateHistory: () => ({ mutate: mockUpdateMutate }),
  useDeleteHistory: () => ({ mutate: mockDeleteMutate }),
  useClearHistory: () => ({ mutate: mockClearMutate }),
  useHistoryExport: () => ({ mutate: mockExportMutate }),
}));

vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

afterEach(() => {
  vi.clearAllMocks();
  searchCalls.length = 0;
});

describe('QueryHistoryList', () => {
  it('clicking an entry calls onSelect with the SQL (no auto-run)', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={onSelect} />);
    await userEvent.click(screen.getByText('SELECT * FROM users'));
    expect(onSelect).toHaveBeenCalledWith('SELECT * FROM users');
  });

  it('toggling the star calls useUpdateHistory with the flipped flag', async () => {
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /star query/i }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ id: 'hist-1', starred: true });
  });

  it('renaming submits the label via useUpdateHistory', async () => {
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /rename query/i }));
    const input = screen.getByPlaceholderText('Label (blank to clear)');
    await userEvent.type(input, 'My query');
    await userEvent.keyboard('{Enter}');
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 'hist-1', label: 'My query' },
      expect.any(Object),
    );
  });

  it('delete fires the danger confirm and calls mutate on confirmation', async () => {
    mockConfirm.mockResolvedValue(true);
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /delete query/i }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockDeleteMutate).toHaveBeenCalledWith('hist-1');
  });

  it('cancelling delete does not call mutate', async () => {
    mockConfirm.mockResolvedValue(false);
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /delete query/i }));
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });

  it('clear fires the danger confirm and clears the active connection', async () => {
    mockConfirm.mockResolvedValue(true);
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /clear history/i }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockClearMutate).toHaveBeenCalledWith('conn-1');
  });

  it('export triggers the export mutation', async () => {
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /export history/i }));
    expect(mockExportMutate).toHaveBeenCalled();
  });

  it('typing in the search box drives the search query', async () => {
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Search history…'), 'orders');
    expect(searchCalls.at(-1)?.search).toBe('orders');
  });

  it('"All connections" relaxes the connection filter', async () => {
    renderWithProviders(<QueryHistoryList connectionId="conn-1" onSelect={vi.fn()} />);
    expect(searchCalls.at(-1)?.connectionId).toBe('conn-1');
    await userEvent.click(screen.getByLabelText('All connections', { selector: 'input' }));
    expect(searchCalls.at(-1)?.connectionId).toBeNull();
    expect(mockClearMutate).not.toHaveBeenCalled();
  });
});
