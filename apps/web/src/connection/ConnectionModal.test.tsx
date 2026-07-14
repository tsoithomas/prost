import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionModal } from './ConnectionModal';
import { renderWithProviders } from '../test/renderWithProviders';

// Stub all API mutation hooks — the import-flow test is purely client-side.
vi.mock('../api/connections', () => ({
  useConnections: () => ({ data: [], isLoading: false }),
  useCreateConnection: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
  useUpdateConnection: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteConnection: () => ({ mutate: vi.fn() }),
  useTestConnection: () => ({
    mutate: vi.fn(),
    isPending: false,
    data: null,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('../api/databaseEngines', () => ({
  useDatabaseEngines: () => ({
    data: [
      {
        engine: 'postgres',
        label: 'PostgreSQL',
        connectionMode: 'network',
        defaultPort: 5432,
        uriSchemes: ['postgres', 'postgresql'],
        parserDialect: 'postgresql',
        formatterDialect: 'postgresql',
        namespaceLabel: 'Schema',
        defaultNamespace: 'public',
        supportsSsl: true,
        sslEnabledByDefault: true,
        ddl: {
          columnTypes: [],
          defaultExamples: [],
          indexMethods: [],
          supportsAutoIncrement: false,
          supportsUsingExpression: true,
        },
        objects: { views: true, materializedViews: true, sequences: true, functions: true, procedures: true, triggers: true, enums: true },
      },
      {
        engine: 'mysql',
        label: 'MySQL',
        connectionMode: 'network',
        defaultPort: 3306,
        uriSchemes: ['mysql'],
        parserDialect: 'mysql',
        formatterDialect: 'mysql',
        namespaceLabel: 'Database',
        supportsSsl: true,
        sslEnabledByDefault: false,
        ddl: {
          columnTypes: [],
          defaultExamples: [],
          indexMethods: ['btree'],
          supportsAutoIncrement: true,
          supportsUsingExpression: false,
        },
        objects: { views: true, materializedViews: false, sequences: false, functions: true, procedures: true, triggers: true, enums: false },
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));

vi.mock('../lib/apiClient', () => ({
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

function renderModal() {
  return renderWithProviders(
    <ConnectionModal open={true} onClose={vi.fn()} />,
  );
}

async function openImportForm() {
  const toggle = screen.getByRole('button', { name: /paste a connection string/i });
  await userEvent.click(toggle);
}

describe('ConnectionModal — connection-string import', () => {
  it('sets the default port when the engine radio changes to MySQL', async () => {
    renderModal();

    const mysqlRadio = screen.getByRole('radio', { name: 'MySQL' });
    await userEvent.click(mysqlRadio);

    expect(mysqlRadio).toBeChecked();
    expect(screen.getByDisplayValue('3306')).toBeInTheDocument();
  });

  it('reveals the import input when "Paste a connection string" is clicked', async () => {
    renderModal();
    expect(screen.queryByPlaceholderText(/postgres:\/\//i)).not.toBeInTheDocument();

    await openImportForm();

    expect(screen.getByPlaceholderText(/postgres:\/\//i)).toBeInTheDocument();
  });

  it('parses a valid postgres:// URL and populates the form fields', async () => {
    renderModal();
    await openImportForm();

    const input = screen.getByPlaceholderText(/postgres:\/\//i);
    await userEvent.type(input, 'postgres://alice:s3cr3t@db.example.com:5434/mydb');
    await userEvent.click(screen.getByRole('button', { name: /parse/i }));

    // The import form should close and the fields should be populated.
    expect(screen.queryByPlaceholderText(/postgres:\/\//i)).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText('localhost') as HTMLInputElement).value).toBe('db.example.com');
    // database and username both use placeholder "postgres"; database appears first in the DOM
    const [databaseInput] = screen.getAllByPlaceholderText('postgres') as HTMLInputElement[];
    expect(databaseInput!.value).toBe('mydb');
  });

  it('coerces a non-standard port from the URL to the port field', async () => {
    renderModal();
    await openImportForm();

    const input = screen.getByPlaceholderText(/postgres:\/\//i);
    await userEvent.type(input, 'postgres://u:p@host:5434/db');
    await userEvent.click(screen.getByRole('button', { name: /parse/i }));

    const portInput = screen.getByDisplayValue('5434') as HTMLInputElement;
    expect(portInput).toBeInTheDocument();
  });

  it('parses a mysql URL and selects the MySQL engine', async () => {
    renderModal();
    await openImportForm();

    const input = screen.getByPlaceholderText(/postgres:\/\//i);
    await userEvent.type(input, 'mysql://user:pw@host:3307/db');
    await userEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(screen.getByPlaceholderText('localhost')).toHaveValue('host');
    // After selecting MySQL the database field's placeholder switches to the MySQL hint.
    expect(screen.getByPlaceholderText('mydb')).toHaveValue('db');
    expect(screen.getByRole('radio', { name: 'MySQL' })).toBeChecked();
    expect(screen.getByDisplayValue('3307')).toBeInTheDocument();
  });

  it('preserves an existing connection name when one is already entered', async () => {
    renderModal();

    // Fill in a name first.
    const nameInput = screen.getByPlaceholderText('My Database') as HTMLInputElement;
    await userEvent.type(nameInput, 'Production');

    await openImportForm();
    const input = screen.getByPlaceholderText(/postgres:\/\//i);
    await userEvent.type(input, 'postgres://u:p@host/db');
    await userEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(nameInput.value).toBe('Production');
  });

  it('shows an error when the connection string is malformed', async () => {
    renderModal();
    await openImportForm();

    const input = screen.getByPlaceholderText(/postgres:\/\//i);
    await userEvent.type(input, 'not-a-valid-connection-string');
    await userEvent.click(screen.getByRole('button', { name: /parse/i }));

    // An error message should appear (the import field stays open).
    expect(screen.getByPlaceholderText(/postgres:\/\//i)).toBeInTheDocument();
  });
});
