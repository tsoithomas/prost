import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionDto, GenerateMigrationResponse, SchemaDiff } from '@prost/shared-types';
import { renderWithProviders } from '../test/renderWithProviders';
import { useDdlStore } from '../stores/ddlStore';
import { SchemaDiffView } from './SchemaDiffView';

const { compareMutate, migrationMutateAsync, mockApiFetch } = vi.hoisted(() => ({
  compareMutate: vi.fn(),
  migrationMutateAsync: vi.fn(),
  mockApiFetch: vi.fn(),
}));

let compareState: { data: SchemaDiff | null; isPending: boolean; isError: boolean; error: unknown } = {
  data: null,
  isPending: false,
  isError: false,
  error: null,
};
let migrationState: { data: GenerateMigrationResponse | null; isPending: boolean; isError: boolean; error: unknown } = {
  data: null,
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('../api/schemaDiff', () => ({
  useSchemaCompare: () => ({ ...compareState, mutate: compareMutate }),
  useGenerateMigration: () => ({ ...migrationState, mutateAsync: migrationMutateAsync }),
}));

const CONNECTIONS: Record<string, Pick<ConnectionDto, 'name'>> = {
  'left-conn': { name: 'Staging' },
  'right-conn': { name: 'Prod' },
};
vi.mock('../api/connections', () => ({
  useConnection: (id: string) => CONNECTIONS[id],
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return { ...actual, apiFetch: mockApiFetch };
});

const DIFF: SchemaDiff = {
  left: { connectionId: 'left-conn', schema: 'public' },
  right: { connectionId: 'right-conn', schema: 'public' },
  tables: [
    {
      name: 'orders',
      status: 'added',
      existsLeft: false,
      existsRight: true,
      columns: [
        {
          name: 'id',
          status: 'added',
          left: null,
          right: { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
        },
      ],
      indexes: [],
      foreignKeys: [],
    },
    { name: 'users', status: 'unchanged', existsLeft: true, existsRight: true, columns: [], indexes: [], foreignKeys: [] },
  ],
};

const MIGRATION: GenerateMigrationResponse = {
  changes: [
    {
      change: {
        kind: 'createTable',
        request: { schema: 'public', table: 'orders', columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false }] },
      },
      sql: 'CREATE TABLE "public"."orders" ("id" integer NOT NULL)',
      destructive: false,
    },
    {
      change: { kind: 'dropTable', request: { schema: 'public', table: 'legacy' } },
      sql: 'DROP TABLE "public"."legacy"',
      destructive: true,
    },
  ],
};

/** `useGenerateMigration` is mocked wholesale (no real react-query), so resolving it must also update
 *  the module-level state the mock reads on the next render — mirrors the codebase's established
 *  `let snapshot; rerender()` idiom (see `PerformancePanel.test.tsx`), just triggered by the component's
 *  own `setChecked` re-render instead of an explicit `rerender()` call. */
function resolveMigrationWith(data: GenerateMigrationResponse) {
  migrationMutateAsync.mockImplementation(async () => {
    migrationState = { ...migrationState, data };
    return data;
  });
}

function renderView() {
  return renderWithProviders(
    <SchemaDiffView connectionId="left-conn" schema="public" compareConnectionId="right-conn" compareSchema="public" />,
  );
}

beforeEach(() => {
  compareState = { data: DIFF, isPending: false, isError: false, error: null };
  migrationState = { data: null, isPending: false, isError: false, error: null };
  compareMutate.mockReset();
  migrationMutateAsync.mockReset();
  mockApiFetch.mockReset();
  useDdlStore.setState({ pending: null });
});

describe('SchemaDiffView', () => {
  it('triggers a compare on mount against the other side', () => {
    renderView();
    expect(compareMutate).toHaveBeenCalledWith({ connectionId: 'right-conn', schema: 'public' });
  });

  it('renders the differing table and hides the unchanged one from the summary list', () => {
    renderView();
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.queryByText('users')).not.toBeInTheDocument();
    expect(screen.getByText(/1 table differs/)).toBeInTheDocument();
    expect(screen.getByText(/1 unchanged/)).toBeInTheDocument();
  });

  it('expands a table row to show its column-level sub-diff', async () => {
    renderView();
    await userEvent.click(screen.getByText('orders'));
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('id')).toBeInTheDocument();
  });

  it('generates a migration and defaults destructive changes to unchecked', async () => {
    resolveMigrationWith(MIGRATION);
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /generate migration/i }));
    await waitFor(() => expect(migrationMutateAsync).toHaveBeenCalledWith({ right: { connectionId: 'right-conn', schema: 'public' }, source: 'left' }));

    const dropRow = screen.getByText(/Drop table public\.legacy/).closest('div')!;
    expect(screen.getByLabelText(/Include: Create table public\.orders/)).toBeChecked();
    expect(screen.getByLabelText(/Include: Drop table public\.legacy/)).not.toBeChecked();
    expect(dropRow.parentElement).toHaveTextContent('destructive');
  });

  it('routes a non-destructive checked change to the ddl modal host on Review, targeting the reconciled (non-source) side', async () => {
    resolveMigrationWith(MIGRATION);
    renderView();
    await userEvent.click(screen.getByRole('button', { name: /generate migration/i }));
    await screen.findByText(/Create table public\.orders/);

    await userEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(useDdlStore.getState().pending).toEqual({
      connectionId: 'right-conn',
      schema: 'public',
      table: 'orders',
      change: MIGRATION.changes[0]!.change,
    });
  });

  it('requires the checkbox before a destructive change can be applied, then confirms and executes it', async () => {
    resolveMigrationWith(MIGRATION);
    mockApiFetch.mockResolvedValue({ schema: 'public', table: 'legacy', sql: 'DROP TABLE "public"."legacy"' });
    renderView();
    await userEvent.click(screen.getByRole('button', { name: /generate migration/i }));
    await screen.findByText(/Drop table public\.legacy/);

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    expect(applyButton).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Include: Drop table public\.legacy/));
    expect(applyButton).toBeEnabled();

    await userEvent.click(applyButton);
    // Two "Apply"-labeled buttons now exist (the row's + the confirm dialog's); the dialog's is the
    // one inside the alertdialog.
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/connections/right-conn/ddl/tables/public/legacy', { method: 'DELETE' }),
    );
  });

  it('reconciles the left side instead when the right side is chosen as the source of truth', async () => {
    resolveMigrationWith(MIGRATION);
    renderView();

    await userEvent.click(screen.getByLabelText(/public \(Prod\)/));
    await userEvent.click(screen.getByRole('button', { name: /generate migration/i }));
    await waitFor(() =>
      expect(migrationMutateAsync).toHaveBeenCalledWith({ right: { connectionId: 'right-conn', schema: 'public' }, source: 'right' }),
    );
    await screen.findByText(/Create table public\.orders/);

    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(useDdlStore.getState().pending).toMatchObject({ connectionId: 'left-conn', schema: 'public' });
  });
});
