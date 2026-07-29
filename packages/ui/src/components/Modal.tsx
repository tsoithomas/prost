import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Surface } from './Surface.js';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible dialog title. Rendered as the heading unless `hideTitle` is set. */
  title: string;
  /** Hide the visual heading while keeping it as the accessible label (e.g. a custom header). */
  hideTitle?: boolean;
  /** `dialog` (default) or `alertdialog` for confirmations. */
  role?: 'dialog' | 'alertdialog';
  /** Sizing/layout classes for the panel Surface. */
  className?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal shell: a token-themed overlay with a centered card (desktop) / bottom sheet
 * (mobile, `max-md:`), trapping focus while open, restoring it to the trigger on close, and closing
 * on `Esc` or an overlay click. `ConfirmDialog` and the settings modal build on this; new modals
 * should adopt it rather than hand-rolling the `fixed inset-0 … bg-black/50` overlay.
 */
export function Modal({ open, onClose, title, hideTitle = false, role = 'dialog', className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the first focusable element in the panel (or the panel itself) on open.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = focusable[0]!;
      const lastEl = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || active === panel)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // Restore focus to whatever opened the modal.
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md max-md:items-end max-md:justify-stretch max-md:p-0"
      onPointerDown={(e) => {
        // Close only when the backdrop itself (not the panel) is pressed.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Surface
        ref={panelRef}
        level="overlay"
        bordered
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'flex flex-col rounded-lg shadow-2xl outline-none max-md:rounded-b-none max-md:rounded-t-lg',
          className,
        )}
      >
        <h2 id={titleId} className={clsx('text-sm font-semibold text-text', hideTitle && 'sr-only')}>
          {title}
        </h2>
        {children}
      </Surface>
    </div>
  );
}
