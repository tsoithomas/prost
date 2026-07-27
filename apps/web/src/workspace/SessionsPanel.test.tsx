import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DbSession } from '@prost/shared-types';
import { SessionsPanel } from './SessionsPanel';

const SESSIONS: DbSession[] = [
  { id: 100, user: 'app', database: 'demo', state: 'active', query: 'SELECT * FROM orders', durationMs: 45000, blockedBy: [] },
];

const mockKillMutate = vi.fn();

vi.mock('../api/sessions', () => ({
  useSessions: () => ({ data: SESSIONS, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useKillSession: () => ({ mutate: mockKillMutate, isPending: false }),
}));

vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));

afterEach(() => {
  mockKillMutate.mockReset();
});

describe('SessionsPanel', () => {
  it('renders the session snapshot', () => {
    render(<SessionsPanel connectionId="c1" writable />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('SELECT * FROM orders')).toBeInTheDocument();
  });

  it('issues a cancel with the right mode after confirming', async () => {
    render(<SessionsPanel connectionId="c1" writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(mockKillMutate).toHaveBeenCalledWith({ sessionId: 100, mode: 'cancel' }, expect.anything()),
    );
  });

  it('issues a terminate with the right mode', async () => {
    render(<SessionsPanel connectionId="c1" writable />);
    await userEvent.click(screen.getByRole('button', { name: 'Terminate' }));
    await waitFor(() =>
      expect(mockKillMutate).toHaveBeenCalledWith({ sessionId: 100, mode: 'terminate' }, expect.anything()),
    );
  });

  it('disables the kill actions on a read-only connection', () => {
    render(<SessionsPanel connectionId="c1" writable={false} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled();
  });
});
