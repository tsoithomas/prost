import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AiState {
  rightSidebarOpen: boolean;
  selectedEndpointId: string | null;
  selectedModel: string | null;
  toggleRightSidebar: () => void;
  setRightSidebarOpen: (open: boolean) => void;
  setSelection: (endpointId: string, model: string) => void;
  clearSelection: () => void;
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      rightSidebarOpen: false,
      selectedEndpointId: null,
      selectedModel: null,
      toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
      setSelection: (endpointId, model) => set({ selectedEndpointId: endpointId, selectedModel: model }),
      clearSelection: () => set({ selectedEndpointId: null, selectedModel: null }),
    }),
    {
      name: 'prost-ai',
    },
  ),
);
