import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AlterTableBody,
  AlterTableResult,
  CreateIndexRequest,
  CreateIndexResult,
  CreateTableBody,
  CreateTableResult,
  DropIndexRequest,
  DropIndexResult,
  DropTableResult,
  TruncateTableResult,
} from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useCreateTable(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTableBody) =>
      apiFetch<CreateTableResult>(`/connections/${connectionId}/ddl/tables`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['metadata', connectionId] });
    },
  });
}

export function useAlterTable(connectionId: string, schema: string, table: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AlterTableBody) =>
      apiFetch<AlterTableResult>(
        `/connections/${connectionId}/ddl/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['table-structure', connectionId, schema, table] });
    },
  });
}

export function useCreateIndex(connectionId: string, schema: string, table: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIndexRequest) =>
      apiFetch<CreateIndexResult>(`/connections/${connectionId}/ddl/indexes`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['table-structure', connectionId, schema, table] });
    },
  });
}

export function useDropIndex(connectionId: string, schema: string, table: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DropIndexRequest) =>
      apiFetch<DropIndexResult>(`/connections/${connectionId}/ddl/indexes`, { method: 'DELETE', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['table-structure', connectionId, schema, table] });
    },
  });
}

/** Drop a table entirely. Invalidates the schema overview + metadata tree. */
export function useDropTable(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table }: { schema: string; table: string }) =>
      apiFetch<DropTableResult>(
        `/connections/${connectionId}/ddl/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_result, { schema }) => {
      void queryClient.invalidateQueries({ queryKey: ['schema-overview', connectionId, schema] });
      void queryClient.invalidateQueries({ queryKey: ['metadata', connectionId] });
    },
  });
}

/** Empty a table (TRUNCATE / DELETE FROM). Invalidates the schema overview so counts refresh. */
export function useTruncateTable(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table }: { schema: string; table: string }) =>
      apiFetch<TruncateTableResult>(
        `/connections/${connectionId}/ddl/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/truncate`,
        { method: 'POST' },
      ),
    onSuccess: (_result, { schema }) => {
      void queryClient.invalidateQueries({ queryKey: ['schema-overview', connectionId, schema] });
    },
  });
}
