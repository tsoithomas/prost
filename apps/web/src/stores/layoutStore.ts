import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 260;

export const MIN_SQL_EDITOR_HEIGHT = 120;
export const MAX_SQL_EDITOR_HEIGHT = 1000;
const DEFAULT_SQL_EDITOR_HEIGHT = 320;

interface LayoutState {
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  /** Collapsed state of the left (Explorer/History/Snippets) sidebar — persisted (Phase 40). */
  leftSidebarCollapsed: boolean;
  /**
   * Focus mode (Phase 40): hides the top bar, both sidebars, and the status bar so the workspace
   * has the full viewport. Not persisted — it's a transient view state, not a layout preference.
   */
  focusMode: boolean;
  /** SQL editor pane height in px, desktop only (Phase 40) — the results pane fills the rest. */
  sqlEditorHeight: number;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  toggleLeftSidebarCollapsed: () => void;
  setFocusMode: (on: boolean) => void;
  toggleFocusMode: () => void;
  setSqlEditorHeight: (height: number) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      rightSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      leftSidebarCollapsed: false,
      focusMode: false,
      sqlEditorHeight: DEFAULT_SQL_EDITOR_HEIGHT,
      setLeftSidebarWidth: (width) => set({ leftSidebarWidth: width }),
      setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
      setLeftSidebarCollapsed: (collapsed) => set({ leftSidebarCollapsed: collapsed }),
      toggleLeftSidebarCollapsed: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
      setFocusMode: (on) => set({ focusMode: on }),
      toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
      setSqlEditorHeight: (height) => set({ sqlEditorHeight: height }),
    }),
    {
      name: 'prost-layout',
      // Focus mode is transient view state, not a saved preference — never restore it on reload.
      partialize: (state) => ({
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarWidth: state.rightSidebarWidth,
        leftSidebarCollapsed: state.leftSidebarCollapsed,
        sqlEditorHeight: state.sqlEditorHeight,
      }),
    },
  ),
);
