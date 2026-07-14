import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchemaMetadata } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { AddForeignKeyModal } from './AddForeignKeyModal';

const { mockMutate, mockPreview } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockPreview: vi.fn((_body: unknown) => ({ sql: null as string | null, error: null as string | null })),
}));

vi.mock('../api/ddl', () => ({
  useAlterTable: () => ({ mutate: mockMutate, isPending: false, reset: vi.fn() }),
}));
vi.mock('../api/ddlPreview', () => ({ useDdlPreview: (_id: string, body: unknown) => mockPreview(body) }));

const META: SchemaMetadata[] = [
  {
    name: 'public',
    tables: [
      {
        schema: 'public',
        name: 'users',
        columns: [
          { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
          { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
        ],
      },
    ],
    objects: [],
  },
];

vi.mock('../api/metadata', () => ({ useMetadata: () => ({ data: META }) }));

const localColumns = [
  { name: 'user_id', dataType: 'integer', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

function open() {
  return renderWithProviders(
    <AddForeignKeyModal open onClose={vi.fn()} connectionId="c1" schema="public" table="orders" availableColumns={localColumns} />,
  );
}

describe('AddForeignKeyModal', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockPreview.mockClear();
  });

  it('builds the expected addForeignKey body from the selections and submits it', async () => {
    open();
    await userEvent.click(screen.getByLabelText('user_id')); // local column
    await userEvent.selectOptions(screen.getByLabelText('Referenced table'), screen.getByRole('option', { name: 'public.users' }));
    await userEvent.click(screen.getByLabelText('id')); // referenced column (PK, listed first)
    await userEvent.selectOptions(screen.getByLabelText('On delete'), 'CASCADE');
    await userEvent.click(screen.getByRole('button', { name: 'Add Foreign Key' }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]![0]).toEqual({
      kind: 'addForeignKey',
      columns: ['user_id'],
      referencedSchema: 'public',
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    });
  });

  it('does not submit until local + referenced columns are chosen with matching counts', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Add Foreign Key' }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('sends a preview request only once the form is complete', async () => {
    open();
    // Incomplete → preview body is null.
    expect(mockPreview).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByLabelText('user_id'));
    await userEvent.selectOptions(screen.getByLabelText('Referenced table'), screen.getByRole('option', { name: 'public.users' }));
    await userEvent.click(screen.getByLabelText('id'));
    // Complete → an alterTable/addForeignKey preview envelope is passed.
    const last = mockPreview.mock.calls.at(-1)![0] as { kind: string; request: { kind: string } } | null;
    expect(last).toMatchObject({ kind: 'alterTable', request: { kind: 'addForeignKey', referencedTable: 'users' } });
  });
});
