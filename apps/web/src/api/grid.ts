import { useMutation } from '@tanstack/react-query';
import type {
  BulkRowUpdateBody,
  BulkRowUpdateResult,
  RowDeleteBody,
  RowInsertBody,
  RowUpdateBody,
} from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

function rowsUrl(connectionId: string, schema: string, table: string): string {
  return `/connections/${connectionId}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows`;
}

export function useUpdateCell(connectionId: string, schema: string, table: string) {
  return useMutation({
    mutationFn: (body: RowUpdateBody) =>
      apiFetch<Record<string, unknown>>(rowsUrl(connectionId, schema, table), { method: 'PATCH', body }),
  });
}

export function useInsertRow(connectionId: string, schema: string, table: string) {
  return useMutation({
    mutationFn: (body: RowInsertBody) =>
      apiFetch<Record<string, unknown>>(rowsUrl(connectionId, schema, table), { method: 'POST', body }),
  });
}

export function useDeleteRow(connectionId: string, schema: string, table: string) {
  return useMutation({
    mutationFn: (body: RowDeleteBody) => apiFetch<void>(rowsUrl(connectionId, schema, table), { method: 'DELETE', body }),
  });
}

export function useBulkUpdate(connectionId: string, schema: string, table: string) {
  return useMutation({
    mutationFn: (body: BulkRowUpdateBody) =>
      apiFetch<BulkRowUpdateResult>(`${rowsUrl(connectionId, schema, table)}/bulk`, { method: 'POST', body }),
  });
}
