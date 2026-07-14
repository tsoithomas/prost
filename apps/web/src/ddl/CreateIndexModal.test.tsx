import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { CreateIndexModal } from './CreateIndexModal';

const { mockPreview } = vi.hoisted(() => ({
  mockPreview: vi.fn(() => ({ sql: 'CREATE INDEX preview', error: null })),
}));

vi.mock('../api/ddl', () => ({
  useCreateIndex: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
}));
vi.mock('../api/ddlPreview', () => ({ useDdlPreview: mockPreview }));

const MYSQL: DbEngineDescriptor = {
  engine: 'mysql', label: 'MySQL', connectionMode: 'network', defaultPort: 3306,
  uriSchemes: ['mysql'], parserDialect: 'mysql', formatterDialect: 'mysql',
  namespaceLabel: 'Database', supportsSsl: true, sslEnabledByDefault: false, supportsCursors: true,
  ddl: {
    columnTypes: ['int'],
    defaultExamples: ['CURRENT_TIMESTAMP'],
    indexMethods: ['btree'],
    supportsAutoIncrement: true,
    supportsUsingExpression: false,
    supportsForeignKeyDdl: true,
  },
  objects: { views: true, materializedViews: false, sequences: false, functions: true, procedures: true, triggers: true, enums: false },
};

vi.mock('../api/databaseEngines', () => ({ useEngineDescriptor: () => MYSQL }));

describe('CreateIndexModal', () => {
  it('offers only descriptor index methods and previews selected columns', async () => {
    renderWithProviders(
      <CreateIndexModal
        open
        onClose={vi.fn()}
        connectionId="conn-1"
        schema="shop"
        table="items"
        availableColumns={[{
          name: 'id', dataType: 'int', nullable: false, isPrimaryKey: true,
          autoIncrement: true, defaultValue: null,
        }]}
      />,
    );

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['btree']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'id' }));
    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'createIndex',
      request: {
        schema: 'shop',
        table: 'items',
        columns: ['id'],
        unique: false,
        method: 'btree',
        name: undefined,
      },
    });
  });
});
