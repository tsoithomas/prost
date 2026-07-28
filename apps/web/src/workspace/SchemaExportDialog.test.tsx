import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/renderWithProviders';
import { SchemaExportDialog } from './SchemaExportDialog';

const { mockMutate, overviewResult } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  // Stable reference across renders (react-query does this in prod); a fresh object each render would
  // loop the "select all on open" effect.
  overviewResult: {
    data: { schema: 'public', tables: [{ name: 'users' }, { name: 'orders' }, { name: 'products' }], totalRowEstimate: 0, totalSizeBytes: 0 },
  },
}));

vi.mock('../api/export', () => ({
  useExport: () => ({ mutate: mockMutate, isPending: false, reset: vi.fn() }),
}));
vi.mock('../api/metadata', () => ({
  useSchemaOverview: () => overviewResult,
}));

describe('SchemaExportDialog', () => {
  it('exports all tables by default with schema + data', async () => {
    mockMutate.mockReset();
    renderWithProviders(<SchemaExportDialog open onClose={vi.fn()} connectionId="c1" schema="public" />);
    await userEvent.click(screen.getByRole('button', { name: /export sql/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'schema', format: 'sql', schema: 'public',
        tables: ['users', 'orders', 'products'], includeSchema: true, includeData: true,
      }),
      expect.any(Object),
    );
  });

  it('exports only the checked tables', async () => {
    mockMutate.mockReset();
    renderWithProviders(<SchemaExportDialog open onClose={vi.fn()} connectionId="c1" schema="public" />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'orders' })); // uncheck
    await userEvent.click(screen.getByRole('button', { name: /export sql/i }));
    expect(mockMutate.mock.calls[0]![0]).toMatchObject({ tables: ['users', 'products'] });
  });

  it('select-none then re-selecting all toggles the whole list', async () => {
    mockMutate.mockReset();
    renderWithProviders(<SchemaExportDialog open onClose={vi.fn()} connectionId="c1" schema="public" />);
    await userEvent.click(screen.getByRole('button', { name: /select none/i }));
    // With nothing selected, export is blocked with an inline error (mutate not called).
    await userEvent.click(screen.getByRole('button', { name: /export sql/i }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/select at least one table/i)).toBeInTheDocument();
  });
});
