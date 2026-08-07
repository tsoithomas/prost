import { beforeEach, describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TableStructure } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { TableStructureToolbar } from './TableStructureToolbar';

const { mockStructure, mockOverview, mockRequest, mockReset } = vi.hoisted(() => ({
  mockStructure: vi.fn(), mockOverview: vi.fn(), mockRequest: vi.fn(), mockReset: vi.fn(),
}));

vi.mock('../api/metadata', () => ({
  useTableStructure: () => mockStructure(),
  useSchemaOverview: () => mockOverview(),
}));
vi.mock('../ddl/SchemaSuggestionList', () => ({
  SchemaSuggestionList: ({ loading }: { loading: boolean }) => (
    <div data-testid="suggestion-list">{loading ? 'loading' : 'ready'}</div>
  ),
}));
vi.mock('../ddl/useSchemaSuggestions', () => ({
  useSchemaSuggestions: () => ({
    suggestions: null, error: null, ready: true, isPending: false, request: mockRequest, reset: mockReset,
  }),
}));

const STRUCTURE: TableStructure = {
  comment: null,
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: true, defaultValue: null },
    { name: 'user_id', dataType: 'integer', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
  ],
  indexes: [
    { name: 'orders_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
  ],
  foreignKeys: [],
};

describe('TableStructureToolbar — size summary', () => {
  beforeEach(() => {
    mockStructure.mockReturnValue({ data: STRUCTURE });
    mockOverview.mockReturnValue({
      data: { tables: [{ name: 'orders', rowEstimate: 405, sizeBytes: 1_572_864 }] },
    });
  });

  it('summarises rows, size and object counts on one line', () => {
    const { container } = renderWithProviders(
      <TableStructureToolbar connectionId="conn-1" schema="public" table="orders" />,
    );
    expect(container.textContent).toContain('~405 rows · 1.5 MB · 2 columns · 1 index');
  });

  it('omits zero counts rather than reporting "0 foreign keys"', () => {
    const { container } = renderWithProviders(
      <TableStructureToolbar connectionId="conn-1" schema="public" table="orders" />,
    );
    expect(container.textContent).not.toContain('foreign');
  });

  it('drops rows and size where the engine reports neither (SQLite)', () => {
    mockOverview.mockReturnValue({
      data: { tables: [{ name: 'orders', rowEstimate: null, sizeBytes: null }] },
    });
    const { container } = renderWithProviders(
      <TableStructureToolbar connectionId="conn-1" schema="public" table="orders" />,
    );
    expect(container.textContent).toContain('2 columns · 1 index');
    expect(container.textContent).not.toContain('rows');
  });
});

describe('TableStructureToolbar — schema suggestions (Phase 33)', () => {
  beforeEach(() => {
    mockRequest.mockClear();
    mockReset.mockClear();
    mockStructure.mockReturnValue({ data: STRUCTURE });
    mockOverview.mockReturnValue({ data: undefined });
  });

  it('asks for suggestions scoped to this table and shows them in a modal', async () => {
    const { getByLabelText, getByRole, queryByRole } = renderWithProviders(
      <TableStructureToolbar connectionId="conn-1" schema="public" table="orders" writable />,
    );

    await userEvent.click(getByLabelText('Suggest improvements'));

    expect(mockRequest).toHaveBeenCalledWith({ tables: [{ schema: 'public', table: 'orders' }] });
    expect(within(getByRole('dialog')).getByTestId('suggestion-list')).toBeInTheDocument();

    // Closing clears the previous answer so reopening can't flash stale advice.
    await userEvent.click(within(getByRole('dialog')).getByLabelText('Close'));
    expect(queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockReset).toHaveBeenCalled();
  });

  it('hides the entry point on a read-only connection (writes are blocked)', () => {
    const { queryByLabelText } = renderWithProviders(
      <TableStructureToolbar connectionId="conn-1" schema="public" table="orders" writable={false} />,
    );
    expect(queryByLabelText('Suggest improvements')).not.toBeInTheDocument();
  });
});
