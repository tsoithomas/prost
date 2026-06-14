import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SqlEditorView } from './SqlEditorView';
import { renderWithProviders } from '../test/renderWithProviders';
import type { QueryResult } from '@prost/shared-types';

// Monaco and AG Grid are heavy; replace them with lightweight stubs.
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco" />,
}));

vi.mock('ag-grid-react', () => ({
  AgGridReact: () => <div data-testid="grid" />,
}));

vi.mock('../grid/columnDefs', () => ({
  buildColumnDefs: () => [],
}));

// Provide a stable connectionId so the Run button is enabled.
vi.mock('../stores/connectionStore', () => ({
  useConnectionStore: (selector: (state: { activeConnectionId: string }) => unknown) =>
    selector({ activeConnectionId: 'conn-1' }),
}));

vi.mock('../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
}));

vi.mock('../hooks/useToasts', () => ({
  useToasts: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('../api/grid', () => ({
  useUpdateCell: () => ({ mutate: vi.fn() }),
  useInsertRow: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteRow: () => ({ mutateAsync: vi.fn() }),
}));

const mockExecuteMutate = vi.fn();

vi.mock('../api/query', () => ({
  useExecuteQuery: () => ({
    mutate: mockExecuteMutate,
    isPending: false,
    error: null,
  }),
}));

const mockCreateSnippetMutate = vi.fn();

vi.mock('../api/snippets', () => ({
  useCreateSnippet: () => ({
    mutate: mockCreateSnippetMutate,
    isPending: false,
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: [{ name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false }],
    rows: [{ id: 1 }],
    totalRows: 1,
    rowCount: 1,
    executionTimeMs: 5,
    command: 'SELECT',
    editable: false,
    primaryKey: [],
    sourceTable: undefined,
    truncated: false,
    ...overrides,
  };
}

function simulateQuery(result: QueryResult) {
  mockExecuteMutate.mockImplementation(
    (_payload: unknown, callbacks: { onSuccess?: (r: QueryResult) => void }) => {
      callbacks?.onSuccess?.(result);
    },
  );
}

describe('SqlEditorView — save snippet', () => {
  it('clicking the bookmark button shows the name input', async () => {
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /save snippet/i }));
    expect(screen.getByPlaceholderText('Snippet name')).toBeInTheDocument();
  });

  it('typing a name and clicking Save calls createSnippet.mutate', async () => {
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /save snippet/i }));
    await userEvent.type(screen.getByPlaceholderText('Snippet name'), 'My query');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreateSnippetMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My query' }),
      expect.any(Object),
    );
  });

  it('clicking Cancel hides the input without calling mutate', async () => {
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /save snippet/i }));
    expect(screen.getByPlaceholderText('Snippet name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cancel save/i }));
    expect(screen.queryByPlaceholderText('Snippet name')).not.toBeInTheDocument();
    expect(mockCreateSnippetMutate).not.toHaveBeenCalled();
  });
});

describe('SqlEditorView — editability gating', () => {
  it('does not show the Add Row button before any query is run', () => {
    renderWithProviders(<SqlEditorView />);
    expect(screen.queryByRole('button', { name: /add row/i })).not.toBeInTheDocument();
  });

  it('shows the Add Row button as disabled when the result is read-only', async () => {
    simulateQuery(makeResult({ editable: false, columns: [{ name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false }] }));

    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const addRowButton = screen.getByRole('button', { name: /add row/i });
    expect(addRowButton).toBeDisabled();
  });

  it('shows the Add Row button as enabled when the result is editable', async () => {
    simulateQuery(
      makeResult({
        editable: true,
        primaryKey: ['id'],
        sourceTable: 'public.users',
        columns: [{ name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false }],
      }),
    );

    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const addRowButton = screen.getByRole('button', { name: /add row/i });
    expect(addRowButton).not.toBeDisabled();
  });

  it('shows "Read-only" badge for a non-editable result', async () => {
    simulateQuery(makeResult({ editable: false, columns: [{ name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false }] }));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('shows "Editable" badge for an editable result', async () => {
    simulateQuery(
      makeResult({ editable: true, primaryKey: ['id'], sourceTable: 'public.users', columns: [{ name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false }] }),
    );
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText('Editable')).toBeInTheDocument();
  });
});
