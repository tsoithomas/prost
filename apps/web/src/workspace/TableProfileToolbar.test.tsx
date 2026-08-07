import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TableProfile } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { TableProfileToolbar } from './TableProfileToolbar';

const { mockProfile, mockRefetch } = vi.hoisted(() => ({ mockProfile: vi.fn(), mockRefetch: vi.fn() }));

vi.mock('../api/metadata', () => ({ useTableProfile: (...args: unknown[]) => mockProfile(...args) }));

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
  ],
};

function loaded<T>(data: T) {
  return { data, isLoading: false, isError: false, isFetching: false, refetch: mockRefetch };
}

function renderToolbar(props: { exact?: boolean; onToggleExact?: () => void } = {}) {
  return renderWithProviders(
    <TableProfileToolbar
      connectionId="c1"
      schema="public"
      table="users"
      exact={props.exact ?? false}
      onToggleExact={props.onToggleExact ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  mockProfile.mockReturnValue(loaded(PROFILE));
  mockRefetch.mockClear();
});

describe('TableProfileToolbar', () => {
  it('summarises what was scanned', () => {
    const { container } = renderToolbar();
    expect(container.textContent).toContain('1 column · 100 rows scanned');
  });

  it('reports the scanned share when sampling stopped short of the table', () => {
    mockProfile.mockReturnValue(loaded({ ...PROFILE, sample: 'random', scannedRows: 50_000, totalRows: 5_000_000 }));
    const { container } = renderToolbar();
    // The `~` is load-bearing: an estimated total must never read as exact.
    expect(container.textContent).toContain('50,000 rows scanned of ~5,000,000');
    expect(screen.getByText('Random sample')).toBeInTheDocument();
  });

  it('labels how the numbers were obtained', () => {
    renderToolbar();
    expect(screen.getByText('Full scan')).toBeInTheDocument();
  });

  it('reports columns left unprofiled on a very wide table', () => {
    mockProfile.mockReturnValue(loaded({ ...PROFILE, columnsOmitted: 12 }));
    renderToolbar();
    expect(screen.getByText('12 columns not profiled')).toBeInTheDocument();
  });

  it('reads the profile at the given exactness and hands the toggle back up', async () => {
    const onToggleExact = vi.fn();
    renderToolbar({ exact: false, onToggleExact });
    expect(mockProfile).toHaveBeenLastCalledWith('c1', 'public', 'users', false);

    await userEvent.click(screen.getByRole('button', { name: 'Exact count' }));
    expect(onToggleExact).toHaveBeenCalled();
  });

  it('re-runs the profile on demand', async () => {
    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'Re-run profile' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('renders nothing but the controls before the first profile lands', () => {
    mockProfile.mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: true, refetch: mockRefetch });
    const { container } = renderToolbar();
    expect(container.textContent).not.toContain('rows scanned');
    expect(screen.getByRole('button', { name: 'Re-run profile' })).toBeDisabled();
  });
});
