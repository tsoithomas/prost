import type { IDatasource, IGetRowsParams } from 'ag-grid-community';
import type { FetchQueryPageResponse } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export interface QueryPageDatasourceOptions {
  connectionId: string;
  /** The single SELECT statement that produced the result (re-run per block at an offset). */
  sql: string;
  /** Called when a block fetch fails, after `failCallback` (e.g. to surface a toast). */
  onError?: (error: unknown) => void;
}

/**
 * AG Grid Infinite Row Model datasource for editor query results. Each block re-runs the
 * single SELECT at the block's offset via `POST :id/query/page` (the same single-statement,
 * offset-paged endpoint the table browser pattern uses). `lastRow` is derived from the
 * server's `truncated` flag: a non-truncated block is the end of the result set.
 */
export function createQueryPageDatasource({ connectionId, sql, onError }: QueryPageDatasourceOptions): IDatasource {
  return {
    getRows: (params: IGetRowsParams) => {
      const offset = params.startRow;
      const limit = params.endRow - params.startRow;
      apiFetch<FetchQueryPageResponse>(`/connections/${connectionId}/query/page`, {
        method: 'POST',
        body: { sql, offset, limit },
      })
        .then((page) => {
          const lastRow = page.truncated ? undefined : offset + page.rows.length;
          params.successCallback(page.rows, lastRow);
        })
        .catch((error) => {
          params.failCallback();
          onError?.(error);
        });
    },
  };
}
