import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 260;

interface LayoutState {
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      rightSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      setLeftSidebarWidth: (width) => set({ leftSidebarWidth: width }),
      setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
    }),
    {
      name: 'prost-layout',
    },
  ),
);
