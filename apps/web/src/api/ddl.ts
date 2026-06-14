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
