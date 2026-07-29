import { useCallback } from 'react';
import type { UserPreferenceDto } from '@prost/shared-types';
import { useUpdatePreferences } from '../api/preferences';

/**
 * Centralizes the optimistic preference write-through: the caller has already applied the change to
 * `themeStore` (so the UI updates instantly), then calls `save(partial)` to persist it. On failure the
 * caller-supplied `onError` surfaces a message — the store value stays applied (no rollback), matching
 * the pre-redesign behavior but in one place instead of duplicated per settings component.
 */
export function useSavePreference(onError?: (message: string) => void) {
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    (dto: Partial<UserPreferenceDto>) => {
      updatePreferences.mutate(dto, {
        onError: () => onError?.('Failed to save preferences — your change may not persist.'),
      });
    },
    [updatePreferences, onError],
  );
}
