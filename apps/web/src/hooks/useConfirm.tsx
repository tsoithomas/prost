import { useCallback, useState } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from '@prost/ui';

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel'>;

interface ConfirmState {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Promise-based replacement for `window.confirm()`:
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: '...', description: '...' }))) return;
 * Render `{dialog}` once near the component root.
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  function handleConfirm() {
    state?.resolve(true);
    setState(null);
  }

  function handleCancel() {
    state?.resolve(false);
    setState(null);
  }

  const dialog = state ? (
    <ConfirmDialog open {...state.options} onConfirm={handleConfirm} onCancel={handleCancel} />
  ) : null;

  return { confirm, dialog };
}
