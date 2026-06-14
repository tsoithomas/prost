import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SnippetDto } from '@prost/shared-types';
import { SnippetList } from './SnippetList';
import { renderWithProviders } from '../test/renderWithProviders';

const mockDeleteMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../api/snippets', () => ({
  useSnippets: () => ({
    data: [
      {
        id: 'snip-1',
        name: 'Get users',
        body: 'SELECT * FROM users',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } satisfies SnippetDto,
    ],
    isLoading: false,
    isError: false,
  }),
  useDeleteSnippet: () => ({ mutate: mockDeleteMutate }),
  useUpdateSnippet: () => ({ mutate: mockUpdateMutate }),
}));

vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('SnippetList', () => {
  it('clicking a snippet calls onSelect with the SQL body', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<SnippetList onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Get users'));
    expect(onSelect).toHaveBeenCalledWith('SELECT * FROM users');
  });

  it('clicking Delete opens confirm dialog and calls mutate on confirmation', async () => {
    mockConfirm.mockResolvedValue(true);
    renderWithProviders(<SnippetList onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /delete get users/i }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockDeleteMutate).toHaveBeenCalledWith('snip-1');
  });

  it('cancelling the Delete confirm does not call mutate', async () => {
    mockConfirm.mockResolvedValue(false);
    renderWithProviders(<SnippetList onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /delete get users/i }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });

  it('clicking Rename shows an input; submitting calls updateSnippet.mutate', async () => {
    renderWithProviders(<SnippetList onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /rename get users/i }));
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'New name');
    await userEvent.keyboard('{Enter}');
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 'snip-1', name: 'New name' },
      expect.any(Object),
    );
  });
});
