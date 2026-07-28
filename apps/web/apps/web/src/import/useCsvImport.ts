import { useCallback, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useImportBatch } from '../api/import';
import { apiErrorDetail } from '../lib/apiClient';

/** Rows per server batch (one transaction). Kept well under the server's per-batch cap (1000). */
const BATCH_SIZE = 500;

export interface ImportProgress {
  processedBytes: number;
  totalBytes: number;
  inserted: number;
}

export interface ImportRunOptions {
  /** Target column names, in the order values are projected. */
  columns: string[];
  /** For each target column, the 0-based index of its source column in the CSV row. */
  sourceIndices: number[];
  /** Skip the first parsed row (the CSV header). */
  hasHeader: boolean;
}

export type ImportPhase = 'idle' | 'running' | 'done' | 'error';

/**
 * Streams a CSV `File` with PapaParse and inserts it in bounded batches — the browser never holds the
 * whole file (each chunk is projected to target rows, flushed at `BATCH_SIZE`, then the parser resumes).
 * Batches insert sequentially so a mid-file failure stops cleanly with an honest partial-insert count.
 */
export function useCsvImport(connectionId: string | null, schema: string, table: string) {
  const batchMutation = useImportBatch(connectionId);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [progress, setProgress] = useState<ImportProgress>({ processedBytes: 0, totalBytes: 0, inserted: 0 });
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const run = useCallback(
    (file: File, opts: ImportRunOptions): Promise<{ inserted: number }> => {
      cancelRef.current = false;
      setPhase('running');
      setError(null);
      setProgress({ processedBytes: 0, totalBytes: file.size, inserted: 0 });

      let inserted = 0;
      let buffer: unknown[][] = [];
      let headerPending = opts.hasHeader;

      const flush = async (): Promise<void> => {
        if (buffer.length === 0) return;
        const rows = buffer;
        buffer = [];
        await batchMutation.mutateAsync({ schema, table, columns: opts.columns, rows });
        inserted += rows.length;
        setProgress((p) => ({ ...p, inserted }));
      };

      return new Promise<{ inserted: number }>((resolve, reject) => {
        Papa.parse<string[]>(file, {
          skipEmptyLines: 'greedy',
          chunk: async (results, parser) => {
            if (cancelRef.current) {
              parser.abort();
              return;
            }
            parser.pause();
            try {
              let data = results.data;
              if (headerPending) {
                data = data.slice(1);
                headerPending = false;
              }
              for (const srcRow of data) {
                buffer.push(opts.sourceIndices.map((i) => srcRow[i] ?? null));
                if (buffer.length >= BATCH_SIZE) await flush();
              }
              setProgress((p) => ({ ...p, processedBytes: results.meta.cursor }));
              parser.resume();
            } catch (err) {
              parser.abort();
              reject(err);
            }
          },
          complete: () => {
            flush()
              .then(() => {
                setPhase('done');
                setProgress((p) => ({ ...p, processedBytes: file.size }));
                resolve({ inserted });
              })
              .catch(reject);
          },
          error: (err: Error) => reject(err),
        });
      }).catch((err: unknown) => {
        setPhase('error');
        setError(apiErrorDetail(err, 'Import failed.'));
        throw err;
      });
    },
    [batchMutation, schema, table],
  );

  return { run, cancel, phase, progress, error };
}
