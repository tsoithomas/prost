import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AiState {
  rightSidebarOpen: boolean;
  selectedEndpointId: string | null;
  selectedModel: string | null;
  /** A prompt handed to the chat panel from elsewhere (e.g. "Fix with AI"); the panel consumes + clears it. */
  pendingChatPrompt: string | null;
  /**
   * When true, the assistant's proposed read-only queries run automatically (skipping the per-query
   * Run/Decline confirm). Persisted across reloads (Phase 31).
   */
  autoRunReadQueries: boolean;
  toggleRightSidebar: () => void;
  setRightSidebarOpen: (open: boolean) => void;
  setSelection: (endpointId: string, model: string) => void;
  clearSelection: () => void;
  /** Open the AI panel and queue a prompt for the chat to auto-send. */
  sendToChat: (prompt: string) => void;
  clearPendingChatPrompt: () => void;
  setAutoRunReadQueries: (on: boolean) => void;
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      rightSidebarOpen: false,
      selectedEndpointId: null,
      selectedModel: null,
      pendingChatPrompt: null,
      autoRunReadQueries: false,
      toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
      setSelection: (endpointId, model) => set({ selectedEndpointId: endpointId, selectedModel: model }),
      clearSelection: () => set({ selectedEndpointId: null, selectedModel: null }),
      sendToChat: (prompt) => set({ pendingChatPrompt: prompt, rightSidebarOpen: true }),
      clearPendingChatPrompt: () => set({ pendingChatPrompt: null }),
      setAutoRunReadQueries: (on) => set({ autoRunReadQueries: on }),
    }),
    {
      name: 'prost-ai',
      // `pendingChatPrompt` is a transient hand-off — never persist it across reloads.
      partialize: (state) => ({
        selectedEndpointId: state.selectedEndpointId,
        selectedModel: state.selectedModel,
        rightSidebarOpen: state.rightSidebarOpen,
        autoRunReadQueries: state.autoRunReadQueries,
      }),
    },
  ),
);
