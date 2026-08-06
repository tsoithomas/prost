import { useMutation } from '@tanstack/react-query';
import type { GenerateMigrationResponse, SchemaDiff, SchemaRef } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

/** Live-vs-live schema compare (Phase 42) — triggered on demand, nothing cached or auto-refetched. */
export function useSchemaCompare(connectionId: string, schema: string) {
  return useMutation({
    mutationFn: (right: SchemaRef) =>
      apiFetch<SchemaDiff>(`/connections/${connectionId}/schema-diff/compare`, {
        method: 'POST',
        body: { schema, right },
      }),
  });
}

/** The reconciling change-set for a compared pair, re-validated server-side (Phase 42). */
export function useGenerateMigration(connectionId: string, schema: string) {
  return useMutation({
    mutationFn: ({ right, source }: { right: SchemaRef; source: 'left' | 'right' }) =>
      apiFetch<GenerateMigrationResponse>(`/connections/${connectionId}/schema-diff/migration`, {
        method: 'POST',
        body: { schema, right, source },
      }),
  });
}
