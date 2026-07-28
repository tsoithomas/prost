import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ImportBatchRequest,
  ImportBatchResponse,
  ImportPreviewRequest,
  ImportPreviewResponse,
} from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

/** Validate a mapping against live metadata + get the INSERT shape (no execution). */
export function useImportPreview(connectionId: string | null) {
  return useMutation({
    mutationFn: (req: ImportPreviewRequest) =>
      apiFetch<ImportPreviewResponse>(`/connections/${connectionId!}/import/preview`, { method: 'POST', body: req }),
  });
}

/** Insert one batch of parsed rows atomically. Called repeatedly by the streaming import loop. */
export function useImportBatch(connectionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: ImportBatchRequest) =>
      apiFetch<ImportBatchResponse>(`/connections/${connectionId!}/import/batch`, { method: 'POST', body: req }),
    onSuccess: () => {
      // A completed import changes row counts + (potentially) freshly-visible tables.
      void queryClient.invalidateQueries({ queryKey: ['schema-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });
    },
  });
}
