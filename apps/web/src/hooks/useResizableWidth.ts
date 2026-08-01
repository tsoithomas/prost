import { useResizablePane } from './useResizablePane';
import type { UseResizablePaneResult } from './useResizablePane';

export interface UseResizableWidthOptions {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** Which edge of the screen the panel is anchored to — determines drag direction. */
  side: 'left' | 'right';
}

export type UseResizableWidthResult = UseResizablePaneResult;

/** Drag-to-resize a panel's width via a handle on its inner edge, persisting through `onResize`. */
export function useResizableWidth({ width, min, max, onResize, side }: UseResizableWidthOptions): UseResizableWidthResult {
  return useResizablePane({ size: width, min, max, onResize, axis: 'horizontal', side });
}
