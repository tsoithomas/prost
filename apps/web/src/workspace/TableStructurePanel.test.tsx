import { describe, expect, it, vi } from 'vitest';
import type { DbEngineDescriptor, TableStructure } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { TableStructurePanel } from './TableStructurePanel';

const { mockStructure, mockDescriptor } = vi.hoisted(() => ({ mockStructure: vi.fn(), mockDescriptor: vi.fn() }));

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

/** A descriptor whose only relevant field is the FK-DDL capability flag. */
function descriptor(supportsForeignKeyDdl: boolean): Partial<DbEngineDescriptor> {
  return { ddl: { supportsForeignKeyDdl } as DbEngineDescriptor['ddl'] };
}

const STRUCTURE: TableStructure = {
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
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
