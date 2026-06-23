import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IGetRowsParams } from 'ag-grid-community';
import { createQueryPageDatasource } from './queryPageDatasource';

const mockApiFetch = vi.fn();
vi.mock('../lib/apiClient', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
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

describe('createQueryPageDatasource', () => {
  it('POSTs the SQL with the block offset/limit and signals more rows when truncated', async () => {
    mockApiFetch.mockResolvedValue({ rows: [{ id: 5 }], truncated: true, executionTimeMs: 1 });
    const ds = createQueryPageDatasource({ connectionId: 'conn-1', sql: 'SELECT * FROM big' });

    const params = makeParams(100, 200);
    ds.getRows(params);

    await vi.waitFor(() => expect(params.successCallback).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith('/connections/conn-1/query/page', {
      method: 'POST',
      body: { sql: 'SELECT * FROM big', offset: 100, limit: 100 },
    });
    // Truncated block → lastRow unknown (more blocks to fetch).
    expect(params.successCallback).toHaveBeenCalledWith([{ id: 5 }], undefined);
  });

  it('reports lastRow at the end of a non-truncated block', async () => {
    mockApiFetch.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], truncated: false, executionTimeMs: 1 });
    const ds = createQueryPageDatasource({ connectionId: 'conn-1', sql: 'SELECT 1' });

    const params = makeParams(40, 140);
    ds.getRows(params);

    await vi.waitFor(() => expect(params.successCallback).toHaveBeenCalled());
    // lastRow = startRow + rows.length = 40 + 2.
    expect(params.successCallback).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }], 42);
  });

  it('calls failCallback and onError when a block fetch fails', async () => {
    const boom = new Error('boom');
    mockApiFetch.mockRejectedValue(boom);
    const onError = vi.fn();
    const ds = createQueryPageDatasource({ connectionId: 'conn-1', sql: 'SELECT 1', onError });

    const params = makeParams(0, 100);
    ds.getRows(params);

    await vi.waitFor(() => expect(params.failCallback).toHaveBeenCalled());
    expect(params.successCallback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
