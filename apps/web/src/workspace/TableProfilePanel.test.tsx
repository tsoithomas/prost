import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnTopValues, TableProfile } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { TableProfilePanel } from './TableProfilePanel';

const { mockProfile, mockTopValues } = vi.hoisted(() => ({
  mockProfile: vi.fn(),
  mockTopValues: vi.fn(),
}));

vi.mock('../api/metadata', () => ({
  useTableProfile: (...args: unknown[]) => mockProfile(...args),
  useColumnTopValues: (...args: unknown[]) => mockTopValues(...args),
}));

const PROFILE: TableProfile = {
  schema: 'public',
  table: 'users',
  scannedRows: 100,
  totalRows: 100,
  sample: 'full',
  exact: false,
  columnsOmitted: 0,
  columns: [
    { column: 'id', dataType: 'integer', nullCount: 0, nullFraction: 0, distinctCount: 100, min: '1', max: '100', comparable: true },
    { column: 'email', dataType: 'text', nullCount: 25, nullFraction: 0.25, distinctCount: 70, min: 'a@x.com', max: 'z@x.com', comparable: true },
    { column: 'payload', dataType: 'json', nullCount: 5, nullFraction: 0.05, distinctCount: null, min: null, max: null, comparable: false },
  ],
};

const TOP_VALUES: ColumnTopValues = {
  column: 'email',
  scannedRows: 100,
  values: [
    { value: 'a@x.com', count: 60, fraction: 0.6 },
    { value: null, count: 25, fraction: 0.25 },
  ],
};

function loaded<T>(data: T) {
  return { data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
}

function renderPanel() {
  return renderWithProviders(<TableProfilePanel connectionId="c1" schema="public" table="users" />);
}

beforeEach(() => {
  mockProfile.mockReturnValue(loaded(PROFILE));
  mockTopValues.mockReturnValue(loaded(TOP_VALUES));
});

describe('TableProfilePanel', () => {
  it('renders a row per column with null share, distinct count and range', () => {
    const { container } = renderPanel();

    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(container.textContent).toContain('25%');
    expect(container.textContent).toContain('70');
    expect(container.textContent).toContain('a@x.com … z@x.com');
  });

  it('reads the profile scoped to the exact setting it is given', () => {
    renderWithProviders(<TableProfilePanel connectionId="c1" schema="public" table="users" exact />);
    expect(mockProfile).toHaveBeenLastCalledWith('c1', 'public', 'users', true);
  });

  it('does not fetch top values until a column is expanded', async () => {
    renderPanel();
    // The top-values query only exists once its row is expanded — nothing fetches on mount.
    expect(mockTopValues).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /email/ }));

    expect(mockTopValues).toHaveBeenCalledWith('c1', 'public', 'users', 'email', false);
    expect(screen.getByText('60 · 60%')).toBeInTheDocument();
    // A null bucket is a real result, rendered as such.
    expect(screen.getByText('∅ null')).toBeInTheDocument();
  });

  it('collapses an expanded column when clicked again', async () => {
    renderPanel();
    const row = screen.getByRole('button', { name: /email/ });

    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('cannot expand a column the engine cannot group, and shows no range for it', () => {
    const { container } = renderPanel();
    const row = screen.getByRole('button', { name: /payload/ });

    expect(row).toBeDisabled();
    expect(row).not.toHaveAttribute('aria-expanded');
    expect(container.textContent).toContain('—');
  });

  it('surfaces loading and error states', () => {
    mockProfile.mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() });
    expect(renderPanel().container.textContent).toContain('Profiling users…');

    mockProfile.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() });
    expect(renderPanel().container.textContent).toContain('Failed to profile this table.');
  });
});
