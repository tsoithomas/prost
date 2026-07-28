import { useMutation } from '@tanstack/react-query';
import type { ExportRequest } from '@prost/shared-types';
import { downloadFile } from '../lib/apiClient';

/**
 * Streams a table or query result to a CSV/JSON file download (`POST :id/export`). The server streams
 * chunked via the Phase 22 cursor; `downloadFile` sends the bearer token and saves the blob. Bounded
 * by the server's export row budget — the UI shows a cap notice.
 */
export function useExport(connectionId: string | null) {
  return useMutation({
    mutationFn: (req: ExportRequest) => {
      const base =
        req.scope === 'table' ? req.table ?? 'table' : req.scope === 'schema' ? req.schema ?? 'schema' : 'query';
      return downloadFile(`/connections/${connectionId!}/export`, req, `${base}.${req.format}`);
    },
  });
}
