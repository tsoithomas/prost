import { useEffect, useState } from 'react';
import type { DdlPreviewResult } from '@prost/shared-types';
import { apiFetch } from '../lib/apiClient';

const DEBOUNCE_MS = 300;

/**
 * `body` is the exact JSON to POST (`{ kind, request }`) or `null` when the form is invalid /
 * incomplete. Debounces valid requests 300ms, ignores superseded/aborted responses, and clears
 * the preview when `body` is null. Returns the server SQL (or null) plus an error string.
 */
export function useDdlPreview(
  connectionId: string,
  body: object | null,
): { sql: string | null; error: string | null } {
  const [sql, setSql] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = body ? JSON.stringify(body) : null;

  useEffect(() => {
    if (!key) {
      setSql(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<DdlPreviewResult>(`/connections/${connectionId}/ddl/preview`, {
        method: 'POST',
        body: JSON.parse(key),
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setSql(result.sql);
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setSql(null);
          setError(err instanceof Error ? err.message : 'Preview failed');
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [connectionId, key]);

  return { sql, error };
}
