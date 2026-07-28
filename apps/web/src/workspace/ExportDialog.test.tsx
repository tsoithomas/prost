import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RowFilter } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { ExportDialog } from './ExportDialog';

const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));

vi.mock('../api/export', () => ({
  useExport: () => ({ mutate: mockMutate, isPending: false, reset: vi.fn() }),
}));

const FILTER: RowFilter = { combinator: 'and', conditions: [{ column: 'id', operator: 'eq', value: 5 }] };

describe('ExportDialog', () => {
  it('exports a table as CSV with the active filter applied by default', async () => {
    mockMutate.mockReset();
    renderWithProviders(
      <ExportDialog open onClose={vi.fn()} connectionId="c1" target={{ scope: 'table', schema: 'public', table: 'users', filter: FILTER }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'table', schema: 'public', table: 'users', format: 'csv', filter: FILTER }),
      expect.any(Object),
    );
  });

  it('omits the filter when "Apply current filter" is unchecked', async () => {
    mockMutate.mockReset();
    renderWithProviders(
      <ExportDialog open onClose={vi.fn()} connectionId="c1" target={{ scope: 'table', schema: 'public', table: 'users', filter: FILTER }} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /apply current filter/i }));
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(mockMutate.mock.calls[0]![0]).not.toHaveProperty('filter');
  });

  it('exports a query result as the chosen format', async () => {
    mockMutate.mockReset();
    renderWithProviders(
      <ExportDialog open onClose={vi.fn()} connectionId="c1" target={{ scope: 'query', sql: 'SELECT 1' }} />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Export format'), 'json');
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'query', sql: 'SELECT 1', format: 'json' }),
      expect.any(Object),
    );
  });

  it('offers SQL for a table and sends schema/data toggles', async () => {
    mockMutate.mockReset();
    renderWithProviders(
      <ExportDialog open onClose={vi.fn()} connectionId="c1" target={{ scope: 'table', schema: 'public', table: 'users' }} />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Export format'), 'sql');
    // Data toggle exists; unchecking it should propagate.
    await userEvent.click(screen.getByRole('checkbox', { name: /include data/i }));
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'table', table: 'users', format: 'sql', includeSchema: true, includeData: false }),
      expect.any(Object),
    );
  });

  it('does not offer SQL for a query result', () => {
    renderWithProviders(
      <ExportDialog open onClose={vi.fn()} connectionId="c1" target={{ scope: 'query', sql: 'SELECT 1' }} />,
    );
    expect(screen.queryByRole('option', { name: 'SQL' })).not.toBeInTheDocument();
  });
});
