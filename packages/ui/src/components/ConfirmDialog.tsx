import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './Button.js';
import { Modal } from './Modal.js';

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
 * Token-themed replacement for `window.confirm()`, built on {@link Modal} (focus-trapped, `Esc`/
 * overlay-click cancels). Centered card on desktop; on mobile a full-width bottom sheet with >=44px
 * buttons.
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
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      role="alertdialog"
      className="w-full max-w-[24rem] gap-md p-lg max-md:max-w-none"
    >
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
    </Modal>
  );
}
