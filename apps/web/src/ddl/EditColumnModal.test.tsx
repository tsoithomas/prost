import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { EditColumnModal } from './EditColumnModal';

const { mockPreview, descriptor } = vi.hoisted(() => ({
  mockPreview: vi.fn(() => ({ sql: 'ALTER TABLE preview', error: null })),
  descriptor: { current: undefined as DbEngineDescriptor | undefined },
}));

vi.mock('../api/ddl', () => ({
  useAlterTable: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
}));
vi.mock('../api/ddlPreview', () => ({ useDdlPreview: mockPreview }));
vi.mock('../api/databaseEngines', () => ({ useEngineDescriptor: () => descriptor.current }));

const BASE: DbEngineDescriptor = {
  engine: 'postgres', label: 'PostgreSQL', connectionMode: 'network', defaultPort: 5432,
  uriSchemes: ['postgresql'], parserDialect: 'postgresql', formatterDialect: 'postgresql',
  namespaceLabel: 'Schema', supportsSsl: true, sslEnabledByDefault: false, supportsCursors: true,
  ddl: {
    columnTypes: ['integer', 'text'],
    defaultExamples: ['now()'],
    indexMethods: ['btree'],
    supportsAutoIncrement: false,
    supportsUsingExpression: true,
    supportsForeignKeyDdl: true,
  },
  objects: { views: true, materializedViews: true, sequences: true, functions: true, procedures: true, triggers: true, enums: true },
};
const COLUMN = {
  name: 'total', dataType: 'integer', nullable: true, isPrimaryKey: false,
  autoIncrement: false, defaultValue: null,
};

function renderModal() {
  return renderWithProviders(
    <EditColumnModal
      open onClose={vi.fn()} col={COLUMN} connectionId="conn-1" schema="public" table="orders"
    />,
  );
}

describe('EditColumnModal', () => {
  beforeEach(() => mockPreview.mockClear());

  it('shows USING for Postgres and sends a flat changeType preview body', () => {
    descriptor.current = BASE;
    renderModal();

    expect(screen.getByPlaceholderText(/USING expr/i)).toBeInTheDocument();
    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'alterTable',
      request: {
        kind: 'changeType',
        schema: 'public',
        table: 'orders',
        columnName: 'total',
        type: 'integer',
        using: undefined,
      },
    });
  });

  it('hides USING for MySQL', () => {
    descriptor.current = {
      ...BASE,
      engine: 'mysql',
      label: 'MySQL',
      parserDialect: 'mysql',
      formatterDialect: 'mysql',
      ddl: { ...BASE.ddl, columnTypes: ['int', 'bigint'], supportsUsingExpression: false },
    };
    renderModal();

    expect(screen.queryByPlaceholderText(/USING expr/i)).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'int' })).toBeInTheDocument();
  });
});
