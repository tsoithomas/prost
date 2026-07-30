import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { DbEngineDescriptor, TableStructure } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { TableStructurePanel } from './TableStructurePanel';

const { mockStructure, mockDescriptor, mockRequest } = vi.hoisted(() => ({
  mockStructure: vi.fn(), mockDescriptor: vi.fn(), mockRequest: vi.fn(),
}));

vi.mock('../api/metadata', () => ({ useTableStructure: () => mockStructure() }));
vi.mock('../api/databaseEngines', () => ({ useEngineDescriptor: () => mockDescriptor() }));
vi.mock('../api/ddl', () => ({
  useDropIndex: () => ({ mutate: vi.fn(), isPending: false }),
  useAlterTable: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn(), dialog: null }) }));
// The DDL modals pull in their own hooks/providers; stub them out — this test only covers the FK section.
vi.mock('../ddl/AddColumnModal', () => ({ AddColumnModal: () => null }));
vi.mock('../ddl/EditColumnModal', () => ({ EditColumnModal: () => null }));
vi.mock('../ddl/CreateIndexModal', () => ({ CreateIndexModal: () => null }));
vi.mock('../ddl/AddForeignKeyModal', () => ({ AddForeignKeyModal: () => null }));
vi.mock('../ddl/EditCommentModal', () => ({
  EditCommentModal: (props: { column?: string; current: string | null }) => (
    <div data-testid="comment-modal" data-column={props.column ?? ''} data-current={props.current ?? ''} />
  ),
}));
vi.mock('../ddl/useSchemaSuggestions', () => ({
  useSchemaSuggestions: () => ({
    suggestions: null, error: null, ready: true, isPending: false, request: mockRequest, reset: vi.fn(),
  }),
}));

/** A descriptor carrying only the DDL capability flags this panel branches on. */
function descriptor(supportsForeignKeyDdl: boolean, supportsObjectComments = true): Partial<DbEngineDescriptor> {
  return { ddl: { supportsForeignKeyDdl, supportsObjectComments } as DbEngineDescriptor['ddl'] };
}

const STRUCTURE: TableStructure = {
  comment: 'Customer orders',
  columns: [
    {
      name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true,
      autoIncrement: false, defaultValue: null, comment: 'Surrogate key',
    },
  ],
  indexes: [],
  foreignKeys: [
    {
      constraintName: 'orders_user_id_fkey',
      columns: ['user_id'],
      referencedSchema: 'public',
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
    },
    {
      constraintName: 'order_items_order_fk',
      columns: ['order_id', 'item_id'],
      referencedSchema: null,
      referencedTable: 'orders',
      referencedColumns: ['id', 'line'],
    },
  ],
};

describe('TableStructurePanel — foreign keys section', () => {
  it('renders each FK with local → referenced columns, a schema prefix, and referential actions', () => {
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(true));
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    expect(container.textContent).toContain('Foreign keys (2)');
    expect(container.textContent).toContain('user_id → public.users(id)');
    expect(container.textContent).toContain('ON DELETE CASCADE');
    // Composite FK, null referencedSchema → no schema prefix.
    expect(container.textContent).toContain('order_items_order_fk');
    expect(container.textContent).toContain('order_id, item_id → orders(id, line)');
  });

  it('shows an empty state when the table has no foreign keys', () => {
    mockStructure.mockReturnValue({
      data: { ...STRUCTURE, foreignKeys: [] },
      isLoading: false,
      isError: false,
    });
    mockDescriptor.mockReturnValue(descriptor(true));
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );
    expect(container.textContent).toContain('Foreign keys (0)');
    expect(container.textContent).toContain('No foreign keys.');
  });
});

describe('TableStructurePanel — FK write affordances', () => {
  it('shows the Add + drop FK affordances when writable and the engine supports FK DDL', () => {
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(true));
    const { getByText, getByLabelText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );
    expect(getByText('Add foreign key')).toBeInTheDocument();
    expect(getByLabelText('Drop foreign key orders_user_id_fkey')).toBeInTheDocument();
  });

  it('hides the affordances when the engine does not support FK DDL (SQLite)', () => {
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(false));
    const { queryByText, queryByLabelText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );
    expect(queryByText('Add foreign key')).not.toBeInTheDocument();
    expect(queryByLabelText('Drop foreign key orders_user_id_fkey')).not.toBeInTheDocument();
  });

  it('hides the affordances on a read-only connection even when the engine supports FK DDL', () => {
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(true));
    const { queryByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable={false} />,
    );
    expect(queryByText('Add foreign key')).not.toBeInTheDocument();
  });
});

describe('TableStructurePanel — schema suggestions (Phase 33)', () => {
  beforeEach(() => {
    mockRequest.mockClear();
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(true));
  });

  it('asks for suggestions scoped to this table', async () => {
    const { getByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );

    await userEvent.click(getByText('Suggest improvements'));

    expect(mockRequest).toHaveBeenCalledWith({ tables: [{ schema: 'public', table: 'orders' }] });
  });

  it('hides the entry point on a read-only connection (writes are blocked)', () => {
    const { queryByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable={false} />,
    );
    expect(queryByText('Suggest improvements')).not.toBeInTheDocument();
  });
});

describe('TableStructurePanel — object comments (Phase 38)', () => {
  beforeEach(() => {
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(true));
  });

  it('renders the table comment and each column comment', () => {
    const { getByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );
    expect(getByText('Customer orders')).toBeInTheDocument();
    expect(getByText('Surrogate key')).toBeInTheDocument();
  });

  it('opens the editor on the table itself', async () => {
    const { getByText, getByTestId } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );

    await userEvent.click(getByText('Edit comment'));

    expect(getByTestId('comment-modal')).toHaveAttribute('data-column', '');
    expect(getByTestId('comment-modal')).toHaveAttribute('data-current', 'Customer orders');
  });

  it('opens the editor on a column, seeded with that column’s comment', async () => {
    const { getByLabelText, getByTestId } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );

    await userEvent.click(getByLabelText('Edit comment on id'));

    expect(getByTestId('comment-modal')).toHaveAttribute('data-column', 'id');
    expect(getByTestId('comment-modal')).toHaveAttribute('data-current', 'Surrogate key');
  });

  it('hides every comment affordance on an engine without comment support', () => {
    mockDescriptor.mockReturnValue(descriptor(true, false));
    const { queryByText, queryByLabelText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );
    expect(queryByText('Edit comment')).not.toBeInTheDocument();
    expect(queryByLabelText('Edit comment on id')).not.toBeInTheDocument();
    // The comment itself is still shown — it's read-only information, not an action.
    expect(queryByText('Customer orders')).toBeInTheDocument();
  });

  it('hides the editor on a read-only connection', () => {
    const { queryByText, queryByLabelText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable={false} />,
    );
    expect(queryByText('Edit comment')).not.toBeInTheDocument();
    expect(queryByLabelText('Edit comment on id')).not.toBeInTheDocument();
  });

  it('offers to add a comment when the table has none', () => {
    mockStructure.mockReturnValue({
      data: { ...STRUCTURE, comment: null },
      isLoading: false,
      isError: false,
    });
    const { getByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" writable />,
    );
    expect(getByText('Add comment')).toBeInTheDocument();
    expect(getByText('No description yet.')).toBeInTheDocument();
  });
});
