import { useCallback, useState } from 'react';
import type { SchemaSuggestRequest, SchemaSuggestion } from '@prost/shared-types';
import { useSuggestSchemaChanges } from '../api/ai';
import { apiErrorDetail } from '../lib/apiClient';
import { useAiStore } from '../stores/aiStore';

/**
 * The shared request/hold/error logic behind every schema-suggestion entry point (Phase 33) — the
 * plan view, the table-structure panel, and the chat. Borrows the chat's model selection from
 * `aiStore`, exactly as the Phase 29 chart suggestion does.
 *
 * `suggestions` is `null` until a request has completed, so callers can tell "not asked yet" from
 * "asked, nothing to suggest".
 */
export function useSchemaSuggestions(connectionId: string | null) {
  const selectedEndpointId = useAiStore((s) => s.selectedEndpointId);
  const selectedModel = useAiStore((s) => s.selectedModel);
  const mutation = useSuggestSchemaChanges(connectionId);

  const [suggestions, setSuggestions] = useState<SchemaSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** True when a model has been picked in the assistant panel — otherwise there's nothing to ask. */
  const ready = Boolean(selectedEndpointId && selectedModel);

  function request(input: Omit<SchemaSuggestRequest, 'endpointId' | 'model'>) {
    if (!selectedEndpointId || !selectedModel) {
      setError('Pick an AI model in the assistant panel first.');
      setSuggestions([]);
      return;
    }
    setError(null);
    mutation.mutate(
      { ...input, endpointId: selectedEndpointId, model: selectedModel },
      {
        onSuccess: (res) => setSuggestions(res.suggestions),
        onError: (err) => {
          setSuggestions([]);
          setError(apiErrorDetail(err, 'Could not get schema suggestions.'));
        },
      },
    );
  }

  // Stable, so callers can depend on it from a `useCallback` without re-creating theirs every render.
  const reset = useCallback(() => {
    setSuggestions(null);
    setError(null);
  }, []);

  return { suggestions, error, ready, isPending: mutation.isPending, request, reset };
}
