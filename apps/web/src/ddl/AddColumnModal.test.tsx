import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { AddColumnModal } from './AddColumnModal';

const { mockMutate, mockPreview, descriptor } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockPreview: vi.fn(() => ({ sql: 'ALTER TABLE preview', error: null })),
  descriptor: { current: undefined as DbEngineDescriptor | undefined },
}));

vi.mock('../api/ddl', () => ({
  useAlterTable: () => ({ mutate: mockMutate, isPending: false, reset: vi.fn() }),
}));
vi.mock('../api/ddlPreview', () => ({ useDdlPreview: mockPreview }));
vi.mock('../api/databaseEngines', () => ({ useEngineDescriptor: () => descriptor.current }));

const MYSQL: DbEngineDescriptor = {
  engine: 'mysql', label: 'MySQL', connectionMode: 'network', defaultPort: 3306,
  uriSchemes: ['mysql'], parserDialect: 'mysql', formatterDialect: 'mysql',
  namespaceLabel: 'Database', supportsSsl: true, sslEnabledByDefault: false,
  ddl: {
    columnTypes: ['int', 'bigint', 'varchar(255)'],
    defaultExamples: ['CURRENT_TIMESTAMP'],
    indexMethods: ['btree'],
    supportsAutoIncrement: true,
    supportsUsingExpression: false,
  },
};

describe('AddColumnModal', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockPreview.mockClear();
    descriptor.current = MYSQL;
  });

  it('uses descriptor types and includes autoIncrement in preview and mutation', async () => {
    renderWithProviders(
      <AddColumnModal open onClose={vi.fn()} connectionId="conn-1" schema="shop" table="items" />,
    );

    expect(screen.getByRole('option', { name: 'int' })).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('column_name'), 'id');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'int');
    await userEvent.click(screen.getByRole('checkbox', { name: /auto-increment/i }));

    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'alterTable',
      request: {
        kind: 'addColumn',
        schema: 'shop',
        table: 'items',
        column: {
          name: 'id',
          type: 'int',
          nullable: true,
          isPrimaryKey: false,
          autoIncrement: true,
          default: undefined,
        },
      },
    });

    await userEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      kind: 'addColumn',
      column: { name: 'id', type: 'int', autoIncrement: true },
    });
  });
});
