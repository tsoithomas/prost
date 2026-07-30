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
  namespaceLabel: 'Database', supportsSsl: true, sslEnabledByDefault: false, supportsCursors: true, supportsQueryPlan: true, supportsExplainAnalyze: true, supportsSessionMonitoring: true,
  ddl: {
    columnTypes: ['int', 'bigint', 'varchar(255)'],
    defaultExamples: ['CURRENT_TIMESTAMP'],
    indexMethods: ['btree'],
    supportsAutoIncrement: true,
    supportsUsingExpression: false,
    supportsForeignKeyDdl: true,
    supportsObjectComments: true,
  },
  objects: { views: true, materializedViews: false, sequences: false, functions: true, procedures: true, triggers: true, enums: false },
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

// Phase 33: an AI "add column" suggestion opens this modal pre-filled via `DdlSuggestionHost`.
describe('AddColumnModal — seeded from a suggestion', () => {
  beforeEach(() => {
    descriptor.current = MYSQL;
    mockPreview.mockClear();
    mockMutate.mockClear();
  });

  it('seeds every field from initialColumn and previews it without interaction', () => {
    renderWithProviders(
      <AddColumnModal
        open onClose={vi.fn()} connectionId="conn-1" schema="shop" table="orders"
        initialColumn={{ name: 'note', type: 'varchar(255)', nullable: true, isPrimaryKey: false, default: "''" }}
      />,
    );

    expect(screen.getByDisplayValue('note')).toBeInTheDocument();
    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'alterTable',
      request: {
        kind: 'addColumn', schema: 'shop', table: 'orders',
        column: {
          name: 'note', type: 'varchar(255)', nullable: true,
          isPrimaryKey: false, autoIncrement: false, default: "''",
        },
      },
    });
  });

  it('submits the seeded column unchanged', async () => {
    renderWithProviders(
      <AddColumnModal
        open onClose={vi.fn()} connectionId="conn-1" schema="shop" table="orders"
        initialColumn={{ name: 'note', type: 'int', nullable: false, isPrimaryKey: false }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add Column' }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'addColumn',
        column: expect.objectContaining({ name: 'note', type: 'int', nullable: false }),
      }),
      expect.anything(),
    );
  });

  it('still opens blank for the normal Add column flow', () => {
    renderWithProviders(
      <AddColumnModal open onClose={vi.fn()} connectionId="conn-1" schema="shop" table="orders" />,
    );
    // No name yet, so there is nothing to preview.
    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', null);
  });
});
