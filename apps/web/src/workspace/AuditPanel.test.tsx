import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditEntryDto } from '@prost/shared-types';
import { AuditPanel } from './AuditPanel';
import { useWorkspaceStore } from '../stores/workspaceStore';

const ENTRIES: AuditEntryDto[] = [
  {
    id: 'a1',
    connectionId: 'c1',
    connectionName: 'Demo',
    action: 'update',
    targetSchema: 'public',
    targetTable: 'users',
    sql: 'UPDATE public.users SET email = ? WHERE id = ?',
    outcome: 'success',
    durationMs: 12,
    createdAt: '2026-07-27T10:00:00.000Z',
  },
  {
    id: 'a2',
    connectionId: 'c1',
    connectionName: 'Demo',
    action: 'ddl',
    targetSchema: 'public',
    targetTable: 'orders',
    sql: 'DROP TABLE public.orders',
    outcome: 'failure',
    errorClass: 'read-only',
    durationMs: 0,
    createdAt: '2026-07-27T09:00:00.000Z',
  },
];

const mockUseAuditList = vi.fn();
const mockExportMutate = vi.fn();

vi.mock('../api/audit', () => ({
  useAuditList: (filters: unknown) => mockUseAuditList(filters),
  useAuditExport: () => ({ mutate: mockExportMutate, isPending: false }),
}));

vi.mock('../api/connections', () => ({
  useConnections: () => ({ data: [{ id: 'c1', name: 'Demo' }] }),
}));

function listResult(over: Partial<ReturnType<typeof baseResult>> = {}) {
  return { ...baseResult(), ...over };
}

function baseResult() {
  return {
    data: { pages: [{ entries: ENTRIES }] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  };
}

beforeEach(() => {
  // Start each test with no audit tab present, so the panel's preset effect stays inert unless a
  // test opts in. Reset here (not afterEach) to avoid re-rendering a mounted panel after mocks reset.
  useWorkspaceStore.setState({ tabs: [{ id: 'query-1', label: 'Query 1', kind: 'query' }], activeTabId: 'query-1' });
});

afterEach(() => {
  mockUseAuditList.mockReset();
  mockExportMutate.mockReset();
});

describe('AuditPanel', () => {
  it('renders entries with action and outcome badges', () => {
    mockUseAuditList.mockReturnValue(listResult());
    render(<AuditPanel />);
    const updateRow = screen.getByText('UPDATE public.users SET email = ? WHERE id = ?').closest('tr')!;
    expect(within(updateRow).getByText('update')).toBeInTheDocument();
    expect(within(updateRow).getByText('success')).toBeInTheDocument();
    expect(within(updateRow).getByText('public.users')).toBeInTheDocument();
    expect(screen.getByText('public.orders')).toBeInTheDocument();
  });

  it('flags a failed entry with its error class', () => {
    mockUseAuditList.mockReturnValue(listResult());
    render(<AuditPanel />);
    const failureRow = screen.getByText('DROP TABLE public.orders').closest('tr')!;
    expect(within(failureRow).getByText('failure')).toBeInTheDocument();
    expect(within(failureRow).getByText('read-only')).toBeInTheDocument();
  });

  it('composes filters into the audit query', async () => {
    mockUseAuditList.mockReturnValue(listResult());
    render(<AuditPanel />);
    await userEvent.selectOptions(screen.getByLabelText('Filter by outcome'), 'failure');
    await waitFor(() =>
      expect(mockUseAuditList).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'failure' })),
    );
  });

  it('triggers an export', async () => {
    mockUseAuditList.mockReturnValue(listResult());
    render(<AuditPanel />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(mockExportMutate).toHaveBeenCalled();
  });

  it('shows Load more when another page is available', () => {
    mockUseAuditList.mockReturnValue(listResult({ hasNextPage: true }));
    render(<AuditPanel />);
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('seeds the connection filter from the audit tab preset and consumes it', async () => {
    mockUseAuditList.mockReturnValue(listResult());
    useWorkspaceStore.setState({
      tabs: [{ id: 'audit', label: 'Audit Log', kind: 'audit', presetConnectionId: 'c1' }],
      activeTabId: 'audit',
    });
    render(<AuditPanel />);
    // The list query is issued scoped to the seeded connection…
    await waitFor(() =>
      expect(mockUseAuditList).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: 'c1' })),
    );
    expect((screen.getByLabelText('Filter by connection') as HTMLSelectElement).value).toBe('c1');
    // …and the one-shot preset is cleared so later manual filter changes aren't overridden.
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === 'audit')?.presetConnectionId).toBeUndefined();
  });
});
