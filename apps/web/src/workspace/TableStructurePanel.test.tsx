import { beforeEach, describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DbEngineDescriptor, TableStructure } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { TableStructurePanel } from './TableStructurePanel';

const { mockStructure, mockDescriptor } = vi.hoisted(() => ({
  mockStructure: vi.fn(), mockDescriptor: vi.fn(),
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
    {
      name: 'user_id', dataType: 'integer', nullable: true, isPrimaryKey: false,
      autoIncrement: false, defaultValue: null,
    },
    {
      name: 'email', dataType: 'character varying', nativeType: 'character varying(120)',
      nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: "''::text",
    },
  ],
  indexes: [
    { name: 'orders_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
    {
      name: 'orders_user_id_idx', columns: ['user_id'], isUnique: false, isPrimary: false,
      method: 'btree', definition: 'CREATE INDEX orders_user_id_idx ON public.orders USING btree (user_id)',
    },
    {
      name: 'orders_email_key', columns: ['email'], isUnique: true, isPrimary: false,
      method: 'btree', definition: 'CREATE UNIQUE INDEX orders_email_key ON public.orders USING btree (email)',
    },
    // Composite unique index: constrains the *pair*, so neither column is unique on its own.
    {
      name: 'orders_user_email_key', columns: ['user_id', 'email'], isUnique: true, isPrimary: false,
      method: 'btree',
      definition: 'CREATE UNIQUE INDEX orders_user_email_key ON public.orders USING btree (user_id, email)',
    },
  ],
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
    const { container, getByRole } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    expect(container.textContent).toContain('Foreign keys (2)');

    // Each FK is one row; the parts live in their own cells, so assert per row rather than on the
    // panel's whole textContent.
    const simple = getByRole('row', { name: /orders_user_id_fkey/ });
    expect(within(simple).getByText('user_id')).toBeInTheDocument();
    expect(within(simple).getByText('public.users(id)')).toBeInTheDocument();
    expect(within(simple).getByText('CASCADE')).toBeInTheDocument();

    // Composite FK, null referencedSchema → no schema prefix.
    const composite = getByRole('row', { name: /order_items_order_fk/ });
    expect(within(composite).getByText('order_id, item_id')).toBeInTheDocument();
    expect(within(composite).getByText('orders(id, line)')).toBeInTheDocument();
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

describe('TableStructurePanel — derived per-column indicators', () => {
  beforeEach(() => {
    mockStructure.mockReturnValue({ data: STRUCTURE, isLoading: false, isError: false });
    mockDescriptor.mockReturnValue(descriptor(true));
  });

  /** The Columns table's rows, keyed by the `data-column` anchor the reveal-column path relies on. */
  function columnRow(container: HTMLElement, name: string): HTMLElement {
    const row = container.querySelector<HTMLElement>(`[data-column="${name}"]`);
    expect(row).not.toBeNull();
    return row!;
  }

  it('marks the primary key and does not count its index in the index chip', () => {
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    const row = columnRow(container, 'id');
    expect(within(row).getByText('Primary key')).toBeInTheDocument();
    // `orders_pkey` is the primary index — the key icon already says so, so there is no chip.
    expect(within(row).queryByLabelText(/index(es)? on id/)).not.toBeInTheDocument();
    expect(within(row).queryByText('Unique')).not.toBeInTheDocument();
  });

  it('counts the indexes on a column and links its FK target', () => {
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    // user_id is in orders_user_id_idx + the composite orders_user_email_key, and points at users.id.
    const userId = columnRow(container, 'user_id');
    expect(within(userId).getByLabelText('2 indexes on user_id')).toHaveTextContent('2');
    expect(
      within(userId).getByLabelText('References users.id (orders_user_id_fkey)'),
    ).toBeInTheDocument();

    // email carries two indexes but no FK.
    const email = columnRow(container, 'email');
    expect(within(email).getByLabelText('2 indexes on email')).toBeInTheDocument();
    expect(within(email).queryByLabelText(/^References/)).not.toBeInTheDocument();
  });

  it('marks a column unique only for a single-column unique index, not a composite one', () => {
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    // email has its own orders_email_key.
    expect(within(columnRow(container, 'email')).getByText('Unique')).toBeInTheDocument();
    // user_id is only in the *composite* orders_user_email_key, which constrains the pair — so
    // claiming user_id is unique would be false.
    expect(within(columnRow(container, 'user_id')).queryByText('Unique')).not.toBeInTheDocument();
  });

  it('summarises the indexes in the chip tooltip', async () => {
    const { container, findByRole } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    await userEvent.hover(within(columnRow(container, 'user_id')).getByLabelText('2 indexes on user_id'));

    const tip = await findByRole('tooltip');
    expect(tip).toHaveTextContent('2 indexes');
    expect(tip).toHaveTextContent('- orders_user_id_idx (user_id)');
    expect(tip).toHaveTextContent('- orders_user_email_key (user_id, email)');
    // Uniqueness belongs to the unique chip, not this tooltip.
    expect(tip).not.toHaveTextContent('unique');
  });

  it('names only the first three indexes and counts the rest', async () => {
    const extra = [4, 5].map((n) => ({
      name: `orders_extra_${n}_idx`, columns: ['user_id'], isUnique: false, isPrimary: false,
      method: 'btree', definition: '',
    }));
    mockStructure.mockReturnValue({
      data: { ...STRUCTURE, indexes: [...STRUCTURE.indexes, ...extra] },
      isLoading: false,
      isError: false,
    });
    const { container, findByRole } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    await userEvent.hover(within(columnRow(container, 'user_id')).getByLabelText('4 indexes on user_id'));

    const tip = await findByRole('tooltip');
    expect(tip).toHaveTextContent('4 indexes');
    expect(tip).toHaveTextContent('... and 1 more');
    expect(tip).not.toHaveTextContent('orders_extra_5_idx');
  });

  it('opens a read-only modal listing the indexes behind the chip', async () => {
    const { container, getByRole, queryByRole } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    await userEvent.click(within(columnRow(container, 'user_id')).getByLabelText('2 indexes on user_id'));

    const dialog = getByRole('dialog');
    expect(within(dialog).getByText('orders_user_id_idx')).toBeInTheDocument();
    expect(within(dialog).getByText('orders_user_email_key')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByLabelText('Close'));
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the referenced table on Structure and reveals the referenced column', async () => {
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    await userEvent.click(
      within(columnRow(container, 'user_id')).getByLabelText('References users.id (orders_user_id_fkey)'),
    );

    const state = useWorkspaceStore.getState();
    const opened = state.tabs.find((tab) => tab.id === 'table:conn-1:public.users');
    expect(opened).toMatchObject({ kind: 'table', table: 'users', viewMode: 'structure' });
    expect(state.revealColumn).toEqual({ schema: 'public', table: 'users', column: 'id' });
  });

  it('clips a comment in its column and opens the full text in a modal', async () => {
    const { container, getByRole, queryByRole } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    const trigger = within(columnRow(container, 'id')).getByLabelText('Show comment on id');
    // The cell itself is one clipped line; the full string lives in the title and the modal.
    expect(trigger).toHaveClass('truncate');
    expect(trigger).toHaveAttribute('title', 'Surrogate key');

    await userEvent.click(trigger);
    expect(within(getByRole('dialog')).getByText('Surrogate key')).toBeInTheDocument();

    await userEvent.click(within(getByRole('dialog')).getByLabelText('Close'));
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders no comment affordance for a column without one', () => {
    const { container } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    expect(
      within(columnRow(container, 'user_id')).queryByLabelText(/^Show comment/),
    ).not.toBeInTheDocument();
  });

  it('chips a MySQL modifier separately from the type it qualifies', () => {
    mockStructure.mockReturnValue({
      data: {
        ...STRUCTURE,
        columns: [{ ...STRUCTURE.columns[0]!, dataType: 'bigint', nativeType: 'bigint unsigned' }],
      },
      isLoading: false,
      isError: false,
    });
    const { getByText, queryByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    expect(getByText('bigint')).toBeInTheDocument();
    expect(getByText('unsigned')).toBeInTheDocument();
    // The two are separate chips, never one run of text.
    expect(queryByText('bigint unsigned')).not.toBeInTheDocument();
  });

  it('shows the native type with its length in preference to the bare catalog type', () => {
    const { getByText, queryByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    expect(getByText('character varying(120)')).toBeInTheDocument();
    expect(queryByText('character varying')).not.toBeInTheDocument();
  });

  it('renders the default value and an auto marker for engine-generated columns', () => {
    mockStructure.mockReturnValue({
      data: {
        ...STRUCTURE,
        columns: [{ ...STRUCTURE.columns[0]!, autoIncrement: true, defaultValue: 'nextval(\'orders_id_seq\')' }],
      },
      isLoading: false,
      isError: false,
    });
    const { getByText } = renderWithProviders(
      <TableStructurePanel connectionId="conn-1" schema="public" table="orders" />,
    );

    expect(getByText("nextval('orders_id_seq')")).toBeInTheDocument();
    expect(getByText('auto')).toBeInTheDocument();
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
