import { describe, expect, it, vi } from 'vitest';
import type { TableStructure } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { TableStructurePanel } from './TableStructurePanel';

const { mockStructure } = vi.hoisted(() => ({ mockStructure: vi.fn() }));

vi.mock('../api/metadata', () => ({ useTableStructure: () => mockStructure() }));
vi.mock('../api/ddl', () => ({ useDropIndex: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn(), dialog: null }) }));
// The DDL modals pull in their own hooks/providers; stub them out — this test only covers the FK section.
vi.mock('../ddl/AddColumnModal', () => ({ AddColumnModal: () => null }));
vi.mock('../ddl/EditColumnModal', () => ({ EditColumnModal: () => null }));
vi.mock('../ddl/CreateIndexModal', () => ({ CreateIndexModal: () => null }));

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
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );
    expect(container.textContent).toContain('Foreign keys (0)');
    expect(container.textContent).toContain('No foreign keys.');
  });
});
