import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactElement, ReactNode, Ref } from 'react';
import clsx from 'clsx';

export interface TooltipProps {
  /** A single focusable/hoverable trigger (e.g. an `IconButton`). Cloned to attach handlers + a ref. */
  children: ReactElement<Record<string, unknown>>;
  /** Tooltip body. */
  content: ReactNode;
  /** Optional trailing chord, e.g. `formatChord(resolveBinding('refresh-view', keybindings))`. */
  shortcut?: string;
  /** Delay before showing, in ms. */
  delay?: number;
}

const OPEN_DELAY_MS = 400;
const EDGE_MARGIN = 8;
const TOP_FLIP_THRESHOLD = 40;

function useIsTouchPrimary(): boolean {
  const [touch, setTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(hover: none)');
    const onChange = (e: MediaQueryListEvent) => setTouch(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return touch;
}

/**
 * A hover + focus tooltip (Phase 40) — unlike native `title`, it fires on keyboard focus, has
 * controllable timing, and can render a keybinding chord. Suppressed entirely on touch-primary
 * devices, where hover has no meaning and long-press already means something in the grid.
 */
export function Tooltip({ children, content, shortcut, delay = OPEN_DELAY_MS }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(
    null,
  );
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const isTouch = useIsTouchPrimary();

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function show() {
    if (isTouch) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const placement: 'top' | 'bottom' = rect.top < TOP_FLIP_THRESHOLD ? 'bottom' : 'top';
      setCoords({
        top: placement === 'top' ? rect.top - EDGE_MARGIN : rect.bottom + EDGE_MARGIN,
        left: Math.min(Math.max(rect.left + rect.width / 2, 60), window.innerWidth - 60),
        placement,
      });
      setOpen(true);
    }, delay);
  }

  function hide() {
    clearTimer();
    setOpen(false);
  }

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') hide();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!isValidElement(children)) return children;

  // JSX elements carry their `ref` outside `props` — merge it with our own rather than clobbering it.
  const originalRef = (children as unknown as { ref?: Ref<HTMLElement> }).ref;

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      if (typeof originalRef === 'function') originalRef(node);
      else if (originalRef && 'current' in originalRef) {
        (originalRef as { current: HTMLElement | null }).current = node;
      }
    },
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: MouseEvent) => {
      (children.props as { onMouseEnter?: (e: MouseEvent) => void }).onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: MouseEvent) => {
      (children.props as { onMouseLeave?: (e: MouseEvent) => void }).onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent) => {
      (children.props as { onFocus?: (e: FocusEvent) => void }).onFocus?.(e);
      show();
    },
    onBlur: (e: FocusEvent) => {
      (children.props as { onBlur?: (e: FocusEvent) => void }).onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {open && coords ? (
        <div
          id={id}
          role="tooltip"
          className={clsx(
            'pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded-sm border',
            'border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-lg',
            coords.placement === 'top' ? '-translate-y-full' : '',
          )}
          style={{ top: coords.top, left: coords.left }}
        >
          {content}
          {shortcut ? (
            <kbd className="ml-1.5 rounded-sm border border-border bg-surface-sunken px-1 font-mono text-[10px] text-text-faint">
              {shortcut}
            </kbd>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
