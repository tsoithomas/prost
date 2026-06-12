import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './Button.js';
import { Surface } from './Surface.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Token-themed replacement for `window.confirm()`. Centered card on desktop; on mobile
 * (`max-md:`) becomes a full-width bottom sheet with >=44px buttons.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md max-md:items-end max-md:justify-stretch max-md:p-0"
      onClick={onCancel}
    >
      <Surface
        level="overlay"
        bordered
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-md rounded-lg p-lg shadow-2xl max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-lg"
      >
        <h2 id="confirm-dialog-title" className="text-sm font-semibold text-text">
          {title}
        </h2>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
        <div className="mt-sm flex justify-end gap-sm max-md:flex-col-reverse">
          <Button variant="ghost" onClick={onCancel} className="max-md:h-11 max-md:text-sm">
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'primary' : 'secondary'}
            onClick={onConfirm}
            className={clsx('max-md:h-11 max-md:text-sm', danger && '!bg-danger !text-danger-fg hover:!bg-danger/90')}
          >
            {confirmLabel}
          </Button>
        </div>
      </Surface>
    </div>
  );
}
