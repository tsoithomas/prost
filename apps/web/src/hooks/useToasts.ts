import { useCallback, useRef, useState } from 'react';
import type { ToastVariant } from '@prost/ui';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

const AUTO_DISMISS_MS = 5000;

/** Minimal toast queue with auto-dismiss, for optimistic-rollback error/success reporting. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = String(nextId.current++);
      setToasts((prev) => [...prev, { id, variant, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
