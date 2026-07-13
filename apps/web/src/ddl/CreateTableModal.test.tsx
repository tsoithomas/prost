import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { CreateTableModal } from './CreateTableModal';
import { renderWithProviders } from '../test/renderWithProviders';

const { mockMutate, mockPreview, descriptorState } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockPreview: vi.fn((_connectionId: string, body: object | null) => ({
    sql: body ? 'CREATE TABLE server_preview' : null,
    error: null,
  })),
  descriptorState: { current: undefined as DbEngineDescriptor | undefined },
}));

vi.mock('../api/ddl', () => ({
  useCreateTable: () => ({ mutate: mockMutate, isPending: false, reset: vi.fn() }),
}));

vi.mock('../api/ddlPreview', () => ({
  useDdlPreview: mockPreview,
}));

vi.mock('../api/databaseEngines', () => ({
  useEngineDescriptor: () => descriptorState.current,
}));

const POSTGRES_DESCRIPTOR: DbEngineDescriptor = {
  engine: 'postgres',
  label: 'PostgreSQL',
  connectionMode: 'network',
  defaultPort: 5432,
  uriSchemes: ['postgresql'],
  parserDialect: 'postgresql',
  formatterDialect: 'postgresql',
  namespaceLabel: 'Schema',
  defaultNamespace: 'public',
  supportsSsl: true,
  sslEnabledByDefault: false,
  supportsCursors: true,
  ddl: {
    columnTypes: ['integer', 'text', 'jsonb'],
    defaultExamples: ['now()', 'gen_random_uuid()'],
    indexMethods: ['btree', 'hash'],
    supportsAutoIncrement: false,
    supportsUsingExpression: true,
  },
  objects: { views: true, materializedViews: true, sequences: true, functions: true, procedures: true, triggers: true, enums: true },
};

const MYSQL_DESCRIPTOR: DbEngineDescriptor = {
  ...POSTGRES_DESCRIPTOR,
  engine: 'mysql',
  label: 'MySQL',
  defaultPort: 3306,
  uriSchemes: ['mysql'],
  parserDialect: 'mysql',
  formatterDialect: 'mysql',
  defaultNamespace: undefined,
  ddl: {
    columnTypes: ['int', 'bigint', 'varchar(255)'],
    defaultExamples: ['CURRENT_TIMESTAMP'],
    indexMethods: ['btree'],
    supportsAutoIncrement: true,
    supportsUsingExpression: false,
  },
};

const DEFAULT_PROPS = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  connectionId: 'conn-1',
  initialSchema: 'public',
  schemas: ['public', 'custom'],
};

function renderModal() {
  return renderWithProviders(<CreateTableModal {...DEFAULT_PROPS} />);
}

describe('CreateTableModal', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockPreview.mockClear();
    descriptorState.current = POSTGRES_DESCRIPTOR;
  });

  it('passes null to preview until the form is valid, then renders server SQL', async () => {
    renderModal();
    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', null);

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'orders');
    await userEvent.type(screen.getByPlaceholderText('column_name'), 'id');

    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', {
      kind: 'createTable',
      request: {
        schema: 'public',
        table: 'orders',
        columns: [{
          name: 'id',
          type: 'text',
          nullable: true,
          isPrimaryKey: false,
          autoIncrement: false,
          default: undefined,
        }],
      },
    });
    expect(screen.getByText('CREATE TABLE server_preview').tagName).toBe('PRE');
  });

  it('blocks invalid submission and submits named columns', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/table name is required/i);
    expect(mockMutate).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'items');
    await userEvent.type(screen.getByPlaceholderText('column_name'), 'title');
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      schema: 'public',
      table: 'items',
      columns: [{ name: 'title', autoIncrement: false }],
    });
  });

  it('adds and removes column rows', async () => {
    renderModal();
    expect(screen.getAllByPlaceholderText('column_name')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(screen.getAllByPlaceholderText('column_name')).toHaveLength(2);

    const removeButtons = screen.getAllByRole('button', { name: /remove column/i });
    await userEvent.click(removeButtons[1]!);
    expect(screen.getAllByPlaceholderText('column_name')).toHaveLength(1);
  });

  it('blocks duplicate column names', async () => {
    renderModal();
    await userEvent.type(screen.getByPlaceholderText('my_table'), 'items');
    await userEvent.type(screen.getByPlaceholderText('column_name'), 'id');
    await userEvent.click(screen.getByRole('button', { name: /add column/i }));
    await userEvent.type(screen.getAllByPlaceholderText('column_name')[1]!, 'id');
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/duplicate column name/i);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('uses MySQL types and carries autoIncrement in preview and mutation payloads', async () => {
    descriptorState.current = MYSQL_DESCRIPTOR;
    renderModal();

    expect(screen.getByRole('option', { name: 'int' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'jsonb' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('my_table'), 'items');
    await userEvent.type(screen.getByPlaceholderText('column_name'), 'id');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '' }), 'int');
    await userEvent.click(screen.getByRole('checkbox', { name: /auto-increment/i }));

    expect(mockPreview).toHaveBeenLastCalledWith('conn-1', expect.objectContaining({
      request: expect.objectContaining({
        columns: [expect.objectContaining({ name: 'id', type: 'int', autoIncrement: true })],
      }),
    }));

    await userEvent.click(screen.getByRole('button', { name: /create table/i }));
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      columns: [expect.objectContaining({ autoIncrement: true })],
    });
  });
});
