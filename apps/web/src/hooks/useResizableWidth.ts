import { useCallback, useRef, useState } from 'react';

export interface UseResizableWidthOptions {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** Which edge of the screen the panel is anchored to — determines drag direction. */
  side: 'left' | 'right';
}

export interface UseResizableWidthResult {
  isResizing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

/** Drag-to-resize a panel's width via a handle on its inner edge, persisting through `onResize`. */
export function useResizableWidth({ width, min, max, onResize, side }: UseResizableWidthOptions): UseResizableWidthResult {
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef({ x: 0, width: 0 });
  const pendingRef = useRef(width);
  const rafRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startRef.current = { x: e.clientX, width };
      pendingRef.current = width;
      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const sign = side === 'left' ? 1 : -1;

      function onMove(ev: PointerEvent) {
        const delta = (ev.clientX - startRef.current.x) * sign;
        pendingRef.current = Math.min(max, Math.max(min, startRef.current.width + delta));
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
    [width, min, max, onResize, side],
  );

  return { isResizing, onPointerDown };
}
