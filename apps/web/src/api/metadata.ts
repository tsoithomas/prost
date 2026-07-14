import { useQuery } from '@tanstack/react-query';
import type {
  SchemaMetadata,
  SchemaObjectDetail,
  SchemaObjectKind,
  SchemaOverview,
  TableStructure,
} from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

export function useMetadata(connectionId: string | null) {
  return useQuery({
    queryKey: ['metadata', connectionId],
    queryFn: () => apiFetch<SchemaMetadata[]>(`/connections/${connectionId}/metadata`),
    enabled: connectionId !== null,
  });
}

export function useSchemaOverview(connectionId: string | null, schema: string) {
  return useQuery({
    queryKey: ['schema-overview', connectionId, schema],
    queryFn: () =>
      apiFetch<SchemaOverview>(`/connections/${connectionId}/schemas/${encodeURIComponent(schema)}/overview`),
    enabled: connectionId !== null && schema !== '',
  });
}

export function useTableStructure(connectionId: string | null, schema: string, table: string) {
  return useQuery({
    queryKey: ['table-structure', connectionId, schema, table],
    queryFn: () =>
      apiFetch<TableStructure>(
        `/connections/${connectionId}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/structure`,
      ),
    enabled: connectionId !== null,
  });
}

export function useObjectDefinition(
  connectionId: string | null,
  schema: string,
  kind: SchemaObjectKind,
  name: string,
) {
  return useQuery({
    queryKey: ['object-definition', connectionId, schema, kind, name],
    queryFn: () =>
      apiFetch<SchemaObjectDetail>(
        `/connections/${connectionId}/schemas/${encodeURIComponent(schema)}/objects/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
      ),
    enabled: connectionId !== null,
  });
}
