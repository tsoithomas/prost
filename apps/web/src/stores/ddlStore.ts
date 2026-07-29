import { create } from 'zustand';
import type { SchemaSuggestionChange } from '@prost/shared-types';

/** A change handed to the DDL modals from outside their usual parents (Phase 33). */
export interface PendingDdl {
  connectionId: string;
  schema: string;
  table: string;
  change: SchemaSuggestionChange;
}

interface DdlState {
  /** The change awaiting review, or `null` when no store-driven modal is open. */
  pending: PendingDdl | null;
  openDdl: (pending: PendingDdl) => void;
  closeDdl: () => void;
}

/**
 * A one-shot hand-off that opens the *existing* DDL modal pre-filled — the same seam
 * `aiStore.pendingChatPrompt` uses for "Fix with AI". `DdlSuggestionHost` (mounted once in
 * `AppLayout`, both shells) consumes it, so an AI suggestion can reach the normal
 * preview → confirm → execute path without a table's structure tab being open.
 *
 * Deliberately not persisted: reviving a half-reviewed schema change on next load would be wrong.
 */
export const useDdlStore = create<DdlState>((set) => ({
  pending: null,
  openDdl: (pending) => set({ pending }),
  closeDdl: () => set({ pending: null }),
}));
