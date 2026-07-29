import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatterLanguage, SqlEditorView } from './SqlEditorView';
import { renderWithProviders } from '../test/renderWithProviders';
import { ApiError } from '../lib/apiClient';
import type {
  CommandStatementResult,
  DbEngineDescriptor,
  ErrorStatementResult,
  ExecuteQueryResponse,
  PlanStatementResult,
  RowsStatementResult,
  StatementResult,
} from '@prost/shared-types';

// Monaco and AG Grid are heavy; replace them with lightweight stubs.
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco" />,
}));

vi.mock('ag-grid-react', () => ({
  AgGridReact: () => <div data-testid="grid" />,
}));

// The chart panel is exercised in ResultChartPanel.test; here we only assert the Grid/Chart toggle
// swaps to it, so a light stub keeps recharts out of this suite.
vi.mock('./ResultChartPanel', () => ({
  ResultChartPanel: () => <div data-testid="result-chart-panel" />,
}));

// FixWithAiButton renders only when an LLM endpoint exists — provide one so the error action shows.
vi.mock('../api/ai', () => ({
  useLlmEndpoints: () => ({
    data: [{ id: 'ep-1', name: 'E', baseUrl: '', models: ['m1'], hasApiKey: true, contextBudget: null, maxOutputTokens: null, createdAt: '' }],
  }),
  useSuggestChart: () => ({ mutate: vi.fn(), isPending: false }),
  useSuggestSchemaChanges: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../grid/columnDefs', () => ({
  buildColumnDefs: () => [],
}));

// Provide a stable connectionId so the Run button is enabled.
vi.mock('../stores/connectionStore', () => ({
  useConnectionStore: (selector: (state: { activeConnectionId: string }) => unknown) =>
    selector({ activeConnectionId: 'conn-1' }),
}));

vi.mock('../api/metadata', () => ({
  useMetadata: () => ({ data: undefined }),
}));

vi.mock('../api/databaseEngines', () => ({
  useEngineDescriptor: () => undefined,
}));

vi.mock('./useMonacoCompletions', () => ({
  useMonacoCompletions: vi.fn(),
}));

vi.mock('sql-formatter', () => ({
  format: (sql: string) => sql.toUpperCase(),
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
const mockExplainMutate = vi.fn();
// Mutable so a test can simulate a transport-level failure (the `executeQuery.error` surface).
let mockExecuteError: unknown = null;

vi.mock('../api/query', () => ({
  useExecuteQuery: () => ({
    mutate: mockExecuteMutate,
    isPending: false,
    error: mockExecuteError,
  }),
  useExplainQuery: () => ({
    mutate: mockExplainMutate,
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
  mockExecuteError = null;
});

function makeRowsResult(overrides: Partial<RowsStatementResult> = {}): RowsStatementResult {
  return {
    kind: 'rows',
    sql: 'SELECT 1',
    columns: [
      { name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
    ],
    rows: [{ id: 1 }],
    totalRows: 1,
    executionTimeMs: 5,
    editable: false,
    primaryKey: [],
    sourceTable: undefined,
    truncated: false,
    ...overrides,
  };
}

function makeCommandResult(overrides: Partial<CommandStatementResult> = {}): CommandStatementResult {
  return {
    kind: 'command',
    sql: "UPDATE users SET email = 'x'",
    command: 'UPDATE',
    rowCount: 1,
    executionTimeMs: 5,
    ...overrides,
  };
}

function makePlanResult(overrides: Partial<PlanStatementResult> = {}): PlanStatementResult {
  return {
    kind: 'plan',
    sql: 'EXPLAIN SELECT 1',
    planText: 'Seq Scan on users',
    analyze: false,
    executionTimeMs: 5,
    ...overrides,
  };
}

function makeErrorResult(overrides: Partial<ErrorStatementResult> = {}): ErrorStatementResult {
  return {
    kind: 'error',
    sql: 'SELECT bad',
    message: 'syntax error',
    code: '42601',
    correlationId: 'corr-1',
    executionTimeMs: 0,
    ...overrides,
  };
}

function makeResponse(statements: StatementResult[], transactional = false, statementCount = statements.length): ExecuteQueryResponse {
  return { statements, transactional, statementCount };
}

function simulateQuery(response: ExecuteQueryResponse) {
  mockExecuteMutate.mockImplementation(
    (_payload: unknown, callbacks: { onSuccess?: (r: ExecuteQueryResponse) => void }) => {
      callbacks?.onSuccess?.(response);
    },
  );
}

function makeDescriptor(
  engine: DbEngineDescriptor['engine'],
  formatterDialect: DbEngineDescriptor['formatterDialect'],
): DbEngineDescriptor {
  return {
    engine,
    label: engine,
    connectionMode: engine === 'sqlite' ? 'file' : 'network',
    uriSchemes: [engine],
    parserDialect: formatterDialect,
    formatterDialect,
    namespaceLabel: 'Schema',
    supportsSsl: engine !== 'sqlite',
    sslEnabledByDefault: false,
    supportsCursors: true,
    supportsQueryPlan: true,
    supportsExplainAnalyze: engine === 'postgres',
    supportsSessionMonitoring: engine !== 'sqlite',
    ddl: {
      columnTypes: [],
      defaultExamples: [],
      indexMethods: [],
      supportsAutoIncrement: true,
      supportsUsingExpression: false,
      supportsForeignKeyDdl: true,
    },
    objects: { views: true, materializedViews: false, sequences: false, functions: true, procedures: true, triggers: true, enums: false },
  };
}

describe('formatterLanguage', () => {
  it.each([
    ['postgres', 'postgresql'],
    ['mysql', 'mysql'],
    ['sqlite', 'sqlite'],
  ] as const)('returns the %s descriptor dialect', (engine, dialect) => {
    expect(formatterLanguage(makeDescriptor(engine, dialect))).toBe(dialect);
  });

  it('defaults to PostgreSQL when the descriptor is unavailable', () => {
    expect(formatterLanguage()).toBe('postgresql');
  });
});

describe('SqlEditorView — toolbar', () => {
  it('renders the Format SQL button', () => {
    renderWithProviders(<SqlEditorView />);
    expect(screen.getByRole('button', { name: /format sql/i })).toBeInTheDocument();
  });
});

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
    simulateQuery(makeResponse([makeRowsResult({ editable: false })]));

    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const addRowButton = screen.getByRole('button', { name: /add row/i });
    expect(addRowButton).toBeDisabled();
  });

  it('shows the Add Row button as enabled when the result is editable', async () => {
    simulateQuery(makeResponse([makeRowsResult({ editable: true, primaryKey: ['id'], sourceTable: 'public.users' })]));

    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const addRowButton = screen.getByRole('button', { name: /add row/i });
    expect(addRowButton).not.toBeDisabled();
  });

  it('shows "Read-only" badge for a non-editable result', async () => {
    simulateQuery(makeResponse([makeRowsResult({ editable: false })]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('shows "Editable" badge for an editable result', async () => {
    simulateQuery(makeResponse([makeRowsResult({ editable: true, primaryKey: ['id'], sourceTable: 'public.users' })]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText('Editable')).toBeInTheDocument();
  });
});

describe('SqlEditorView — multi-statement results', () => {
  it('renders one panel per statement and no editability controls', async () => {
    simulateQuery(makeResponse([makeRowsResult({ sql: 'SELECT id FROM users' }), makeCommandResult()]));

    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(screen.getByTestId('statement-panel-0')).toBeInTheDocument();
    expect(screen.getByTestId('statement-panel-1')).toBeInTheDocument();
    expect(screen.queryByText('Editable')).not.toBeInTheDocument();
    expect(screen.queryByText('Read-only')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add row/i })).not.toBeInTheDocument();
  });

  it('shows a placeholder when the script splits into zero statements', async () => {
    simulateQuery(makeResponse([]));

    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(screen.getByText('No statements to run.')).toBeInTheDocument();
  });
});

describe('SqlEditorView — row count', () => {
  it('shows an exact count for a complete result', async () => {
    simulateQuery(makeResponse([makeRowsResult({ rows: [{ id: 1 }], truncated: false })]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText(/^1 row\b/)).toBeInTheDocument();
  });

  it('shows a "N+" count for a truncated result (more rows load on scroll)', async () => {
    simulateQuery(makeResponse([makeRowsResult({ rows: [{ id: 1 }], truncated: true })]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText(/^1\+ rows\b/)).toBeInTheDocument();
  });
});

describe('SqlEditorView — transaction toggle', () => {
  it('is unchecked by default and is passed to executeQuery.mutate when checked', async () => {
    simulateQuery(makeResponse([makeCommandResult()]));
    renderWithProviders(<SqlEditorView />);

    const checkbox = screen.getByRole('checkbox', { name: /run as transaction/i });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(mockExecuteMutate).toHaveBeenCalledWith(expect.objectContaining({ transactional: true }), expect.any(Object));
  });
});

describe('SqlEditorView — EXPLAIN', () => {
  it('renders plan text in a <pre> block for a single EXPLAIN statement', async () => {
    simulateQuery(makeResponse([makePlanResult({ planText: 'Seq Scan on users', analyze: false })]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const planText = screen.getByText('Seq Scan on users');
    expect(planText.tagName).toBe('PRE');
    expect(screen.queryByText('This executes')).not.toBeInTheDocument();
  });

  it('shows "This executes" badge for EXPLAIN ANALYZE', async () => {
    simulateQuery(makeResponse([makePlanResult({ planText: 'Seq Scan ...', analyze: true })]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(screen.getByText('This executes')).toBeInTheDocument();
  });
});

describe('SqlEditorView — per-statement error', () => {
  it('shows the failing statement details alongside a successful sibling', async () => {
    simulateQuery(
      makeResponse([makeRowsResult({ sql: 'SELECT 1' }), makeErrorResult({ message: 'duplicate key value', code: '23505', correlationId: 'corr-123' })]),
    );
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(screen.getByTestId('statement-panel-0')).toBeInTheDocument();
    const errorPanel = screen.getByTestId('statement-panel-1');
    expect(errorPanel).toHaveTextContent('duplicate key value');
    expect(errorPanel).toHaveTextContent('23505');
    expect(errorPanel).toHaveTextContent('ref: corr-123');
  });
});

describe('SqlEditorView — rolled-back transaction note', () => {
  it('shows "N of M statement(s) ran" when a transactional batch is rolled back early', async () => {
    simulateQuery(makeResponse([makeCommandResult(), makeErrorResult()], true, 3));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(screen.getByText(/2 of 3 statement\(s\) ran/)).toBeInTheDocument();
  });
});

describe('SqlEditorView — chart view', () => {
  it('toggling to Chart swaps the grid for the chart panel without a re-fetch', async () => {
    simulateQuery(makeResponse([makeRowsResult({ rows: [{ id: 1 }, { id: 2 }] })]));
    renderWithProviders(<SqlEditorView />);

    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByTestId('grid')).toBeInTheDocument();
    expect(mockExecuteMutate).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /^chart$/i }));
    expect(screen.getByTestId('result-chart-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
    // Charting reads the already-loaded page — no additional query is issued.
    expect(mockExecuteMutate).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /^grid$/i }));
    expect(screen.getByTestId('grid')).toBeInTheDocument();
    expect(screen.queryByTestId('result-chart-panel')).not.toBeInTheDocument();
  });

  it('does not offer the Grid/Chart toggle for a non-rows result', async () => {
    simulateQuery(makeResponse([makeCommandResult()]));
    renderWithProviders(<SqlEditorView />);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.queryByRole('button', { name: /^chart$/i })).not.toBeInTheDocument();
  });
});

describe('SqlEditorView — explain a transport error', () => {
  it('offers "Fix with AI" on the query-failure surface', async () => {
    mockExecuteError = new ApiError(500, 'SQL_ERROR', 'relation "ghost" does not exist', 'corr-9');
    renderWithProviders(<SqlEditorView />);
    expect(screen.getByText('relation "ghost" does not exist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fix with ai/i })).toBeInTheDocument();
  });
});
