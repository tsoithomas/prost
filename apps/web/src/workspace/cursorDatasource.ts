import type { IDatasource, IGetRowsParams } from 'ag-grid-community';
import type { FetchCursorResponse, FetchQueryPageResponse, OpenCursorResponse } from '@prost/shared-types';
import { ApiError, apiFetch } from '../lib/apiClient';

export interface CursorDatasourceOptions {
  connectionId: string;
  /** The single SELECT that produced the result — opens the cursor and backs the offset fallback. */
  sql: string;
  /** Block fetch failed (after `failCallback`) — e.g. to surface a toast. */
  onError?: (error: unknown) => void;
  /** The server-side row budget was hit; `rowsServed` is how many rows the stream delivered. */
  onTruncated?: (rowsServed: number) => void;
  /** The cursor session expired/was reaped; the datasource has fallen back to offset paging. */
  onReaped?: () => void;
}

/**
 * AG Grid Infinite Row Model datasource for **large** editor results, backed by a forward-only
 * server-side cursor (`POST :id/query/cursor` + `.../fetch`). Sequential forward blocks stream from
 * the held cursor (no growing-OFFSET re-scan); a backward/gap block — or a reaped session — falls
 * back to the offset `/query/page` endpoint so the grid never wedges (architecture principle §11).
 * The session is closed via `destroy()` when the grid tears it down (new run / tab switch / unmount).
 *
 * NOTE: the editor grid must run with `maxConcurrentDatasourceRequests={1}` — a held cursor can only
 * serve one forward fetch at a time.
 */
export function createCursorDatasource(opts: CursorDatasourceOptions): IDatasource {
  let sessionId: string | null = null;
  // Rows served from the live cursor so far — the next forward block must start exactly here.
  let position = 0;

  const closeSession = (): void => {
    if (!sessionId) return;
    const id = sessionId;
    sessionId = null;
    position = 0;
    void apiFetch(`/connections/${opts.connectionId}/query/cursor/${id}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const offsetFallback = (params: IGetRowsParams, offset: number, limit: number): void => {
    apiFetch<FetchQueryPageResponse>(`/connections/${opts.connectionId}/query/page`, {
      method: 'POST',
      body: { sql: opts.sql, offset, limit },
    })
      .then((page) => {
        const lastRow = page.truncated ? undefined : offset + page.rows.length;
        params.successCallback(page.rows, lastRow);
      })
      .catch((error) => {
        params.failCallback();
        opts.onError?.(error);
      });
  };

  return {
    getRows: (params: IGetRowsParams) => {
      const start = params.startRow;
      const limit = params.endRow - params.startRow;

      // Forward sequential block on the live cursor — the fast path.
      if (sessionId && start === position) {
        apiFetch<FetchCursorResponse>(`/connections/${opts.connectionId}/query/cursor/${sessionId}/fetch`, {
          method: 'POST',
          body: { limit },
        })
          .then((block) => {
            position += block.rows.length;
            if (block.truncated) opts.onTruncated?.(position);
            const lastRow = block.complete ? position : undefined;
            params.successCallback(block.rows, lastRow);
          })
          .catch((error) => {
            if (error instanceof ApiError && error.status === 404) {
              // Session reaped/expired — recover by continuing in offset-paged mode from here.
              closeSession();
              opts.onReaped?.();
              offsetFallback(params, start, limit);
              return;
            }
            params.failCallback();
            opts.onError?.(error);
          });
        return;
      }

      // Top of the result — (re)open a fresh cursor.
      if (start === 0) {
        closeSession();
        apiFetch<OpenCursorResponse>(`/connections/${opts.connectionId}/query/cursor`, {
          method: 'POST',
          body: { sql: opts.sql },
        })
          .then((open) => {
            sessionId = open.complete ? null : open.sessionId;
            position = open.rows.length;
            if (open.truncated) opts.onTruncated?.(open.rows.length);
            const lastRow = open.complete ? open.rows.length : undefined;
            params.successCallback(open.rows, lastRow);
          })
          .catch((error) => {
            params.failCallback();
            opts.onError?.(error);
          });
        return;
      }

      // Backward or forward-gap block a forward-only cursor can't serve — page it by offset and
      // leave the cursor where it is.
      offsetFallback(params, start, limit);
    },
    destroy: () => closeSession(),
  };
}
