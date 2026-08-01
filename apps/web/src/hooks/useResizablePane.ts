import { useCallback, useRef, useState } from 'react';

export interface UseResizablePaneOptions {
  size: number;
  min: number;
  max: number;
  onResize: (size: number) => void;
  axis: 'horizontal' | 'vertical';
  /** Which edge of the screen/container the panel is anchored to — determines drag direction. */
  side: 'left' | 'right' | 'top' | 'bottom';
}

export interface UseResizablePaneResult {
  isResizing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

/**
 * Drag-to-resize a panel's width or height via a handle on its inner edge, persisting through
 * `onResize`. Generalizes the original width-only hook (Phase 40's editor/results split needs the
 * vertical axis too) rather than duplicating the drag math.
 */
export function useResizablePane({ size, min, max, onResize, axis, side }: UseResizablePaneOptions): UseResizablePaneResult {
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef({ pos: 0, size: 0 });
  const pendingRef = useRef(size);
  const rafRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startPos = axis === 'horizontal' ? e.clientX : e.clientY;
      startRef.current = { pos: startPos, size };
      pendingRef.current = size;
      setIsResizing(true);
      document.body.style.cursor = axis === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      // A pane anchored to the leading edge (left/top) grows as the pointer moves away from it;
      // one anchored to the trailing edge (right/bottom) grows as the pointer moves toward it.
      const sign = side === 'left' || side === 'top' ? 1 : -1;

      function onMove(ev: PointerEvent) {
        const pos = axis === 'horizontal' ? ev.clientX : ev.clientY;
        const delta = (pos - startRef.current.pos) * sign;
        pendingRef.current = Math.min(max, Math.max(min, startRef.current.size + delta));
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            onResize(pendingRef.current);
          });
        }
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          onResize(pendingRef.current);
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setIsResizing(false);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [size, min, max, onResize, axis, side],
  );

  return { isResizing, onPointerDown };
}
