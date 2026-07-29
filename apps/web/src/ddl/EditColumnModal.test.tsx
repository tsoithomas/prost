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
  namespaceLabel: 'Schema', supportsSsl: true, sslEnabledByDefault: false, supportsCursors: true, supportsQueryPlan: true, supportsExplainAnalyze: true, supportsSessionMonitoring: true,
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

// Phase 33: an AI suggestion opens this same modal, seeding + highlighting the section it targets.
describe('EditColumnModal — seeded from a suggestion', () => {
  beforeEach(() => {
    descriptor.current = BASE;
    mockPreview.mockClear();
  });

  it('seeds the new type from a changeType suggestion and previews it unprompted', () => {
    renderWithProviders(
      <EditColumnModal
        open onClose={vi.fn()} col={COLUMN} connectionId="conn-1" schema="public" table="orders"
        initialOperation={{ kind: 'changeType', column: 'total', type: 'text' }}
      />,
    );

    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'alterTable',
      request: {
        kind: 'changeType', schema: 'public', table: 'orders',
        columnName: 'total', type: 'text', using: undefined,
      },
    });
  });

  it('seeds the default value from a setDefault suggestion', () => {
    renderWithProviders(
      <EditColumnModal
        open onClose={vi.fn()} col={COLUMN} connectionId="conn-1" schema="public" table="orders"
        initialOperation={{ kind: 'setDefault', column: 'total', default: '0' }}
      />,
    );

    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  });

  it('flips the nullable checkbox for a setNotNull suggestion', () => {
    renderWithProviders(
      <EditColumnModal
        open onClose={vi.fn()} col={COLUMN} connectionId="conn-1" schema="public" table="orders"
        initialOperation={{ kind: 'setNotNull', column: 'total', notNull: true }}
      />,
    );

    // The column is nullable today; the suggestion proposes NOT NULL, so the box starts unchecked.
    expect(screen.getByRole('checkbox', { name: 'Nullable' })).not.toBeChecked();
  });

  it('falls back to the column\'s own values when no suggestion is given', () => {
    renderWithProviders(
      <EditColumnModal
        open onClose={vi.fn()} col={COLUMN} connectionId="conn-1" schema="public" table="orders"
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Nullable' })).toBeChecked();
    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'alterTable',
      request: {
        kind: 'changeType', schema: 'public', table: 'orders',
        columnName: 'total', type: 'integer', using: undefined,
      },
    });
  });
});
