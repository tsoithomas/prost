import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IGetRowsParams } from 'ag-grid-community';
import { createCursorDatasource } from './cursorDatasource';

const { mockApiFetch, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(public readonly status: number) {
      super('api error');
      this.name = 'ApiError';
    }
  }
  return { mockApiFetch: vi.fn(), MockApiError };
});

vi.mock('../lib/apiClient', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  ApiError: MockApiError,
}));

beforeEach(() => {
  mockApiFetch.mockReset();
});

function makeParams(startRow: number, endRow: number): IGetRowsParams {
  return {
    startRow,
    endRow,
    sortModel: [],
    filterModel: {},
    successCallback: vi.fn(),
    failCallback: vi.fn(),
    context: undefined,
  } as unknown as IGetRowsParams;
}

const rowsFrom = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: start + i }));

describe('createCursorDatasource', () => {
  it('opens a cursor for block 0 and reports more rows when not complete', async () => {
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-1', rows: rowsFrom(0, 100), columns: [], totalRows: 100, editable: false, complete: false });
    const ds = createCursorDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big' });

    const params = makeParams(0, 100);
    ds.getRows(params);

    await vi.waitFor(() => expect(params.successCallback).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith('/connections/conn-1/query/cursor', {
      method: 'POST',
      body: { sql: 'SELECT * FROM big' },
    });
    expect(params.successCallback).toHaveBeenCalledWith(rowsFrom(0, 100), undefined);
  });

  it('fetches the next forward block from the open session and ends on complete', async () => {
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-1', rows: rowsFrom(0, 100), columns: [], totalRows: 100, editable: false, complete: false });
    const ds = createCursorDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big' });

    const open = makeParams(0, 100);
    ds.getRows(open);
    await vi.waitFor(() => expect(open.successCallback).toHaveBeenCalled());

    mockApiFetch.mockResolvedValueOnce({ rows: rowsFrom(100, 40), complete: true, executionTimeMs: 1 });
    const next = makeParams(100, 200);
    ds.getRows(next);

    await vi.waitFor(() => expect(next.successCallback).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenLastCalledWith('/connections/conn-1/query/cursor/sess-1/fetch', {
      method: 'POST',
      body: { limit: 100 },
    });
    // Completed forward block → lastRow = total served (100 + 40).
    expect(next.successCallback).toHaveBeenCalledWith(rowsFrom(100, 40), 140);
  });

  it('falls back to the offset endpoint for a backward / gap block the cursor cannot serve', async () => {
    const ds = createCursorDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big' });
    mockApiFetch.mockResolvedValueOnce({ rows: rowsFrom(40, 100), truncated: true, executionTimeMs: 1 });

    const params = makeParams(40, 140); // no session yet and startRow !== 0
    ds.getRows(params);

    await vi.waitFor(() => expect(params.successCallback).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith('/connections/conn-1/query/page', {
      method: 'POST',
      body: { sql: 'SELECT * FROM big', offset: 40, limit: 100 },
    });
    expect(params.successCallback).toHaveBeenCalledWith(rowsFrom(40, 100), undefined);
  });

  it('recovers from a reaped session by paging via offset and notifying onReaped', async () => {
    const onReaped = vi.fn();
    const ds = createCursorDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big', onReaped });

    // Route by path/method: a forward fetch 404s (reaped), the DELETE cleanup resolves, and the
    // datasource retries the same block via /query/page.
    mockApiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/connections/conn-1/query/cursor') {
        return Promise.resolve({ sessionId: 'sess-1', rows: rowsFrom(0, 100), columns: [], totalRows: 100, editable: false, complete: false });
      }
      if (path.endsWith('/fetch')) return Promise.reject(new MockApiError(404));
      if (path === '/connections/conn-1/query/page') {
        return Promise.resolve({ rows: rowsFrom(100, 100), truncated: false, executionTimeMs: 1 });
      }
      if (opts?.method === 'DELETE') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const open = makeParams(0, 100);
    ds.getRows(open);
    await vi.waitFor(() => expect(open.successCallback).toHaveBeenCalled());

    const next = makeParams(100, 200);
    ds.getRows(next);

    await vi.waitFor(() => expect(next.successCallback).toHaveBeenCalled());
    expect(onReaped).toHaveBeenCalled();
    expect(mockApiFetch).toHaveBeenLastCalledWith('/connections/conn-1/query/page', {
      method: 'POST',
      body: { sql: 'SELECT * FROM big', offset: 100, limit: 100 },
    });
    expect(next.successCallback).toHaveBeenCalledWith(rowsFrom(100, 100), 200);
  });

  it('reports truncation and the final row count when the open result hits the budget', async () => {
    const onTruncated = vi.fn();
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-1', rows: rowsFrom(0, 80), columns: [], totalRows: 80, editable: false, complete: true, truncated: true });
    const ds = createCursorDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big', onTruncated });

    const params = makeParams(0, 100);
    ds.getRows(params);

    await vi.waitFor(() => expect(params.successCallback).toHaveBeenCalled());
    expect(onTruncated).toHaveBeenCalledWith(80);
    expect(params.successCallback).toHaveBeenCalledWith(rowsFrom(0, 80), 80);
  });

  it('closes the session on destroy', async () => {
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-1', rows: rowsFrom(0, 100), columns: [], totalRows: 100, editable: false, complete: false });
    const ds = createCursorDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big' });

    const open = makeParams(0, 100);
    ds.getRows(open);
    await vi.waitFor(() => expect(open.successCallback).toHaveBeenCalled());

    mockApiFetch.mockResolvedValueOnce(undefined);
    ds.destroy?.();

    await vi.waitFor(() =>
      expect(mockApiFetch).toHaveBeenLastCalledWith('/connections/conn-1/query/cursor/sess-1', { method: 'DELETE' }),
    );
  });
});
