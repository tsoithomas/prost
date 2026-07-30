import { KEYBINDING_ACTIONS } from '@prost/shared-types';
import { Modal } from '@prost/ui';
import { formatChord, resolveBinding } from '../keybindings';
import { useShortcutsStore } from '../stores/shortcutsStore';
import { useThemeStore } from '../stores/themeStore';

/**
 * Keyboard-shortcuts help overlay: lists every remappable action with its **resolved** chord (so a
 * user's remap from Settings shows through). Built on the shared `Modal` and opened by the
 * `show-shortcuts` keybinding, from the command palette, or a menu.
 */
export function ShortcutsHelp() {
  const open = useShortcutsStore((s) => s.open);
  const close = useShortcutsStore((s) => s.closeShortcuts);
  const keybindings = useThemeStore((s) => s.keybindings);

  return (
    <Modal open={open} onClose={close} title="Keyboard shortcuts" hideTitle className="w-full max-w-md gap-0 p-0">
      <div className="flex items-center justify-between border-b border-border px-lg py-md">
        <h2 className="text-sm font-semibold text-text">Keyboard shortcuts</h2>
      </div>
      <ul className="flex flex-col divide-y divide-border p-lg">
        {KEYBINDING_ACTIONS.map((action) => (
          <li key={action.id} className="flex items-center justify-between gap-md py-2 text-sm">
            <span className="text-text">{action.label}</span>
            <kbd className="rounded-sm border border-border bg-surface-sunken px-sm py-0.5 font-mono text-xs text-text-muted">
              {formatChord(resolveBinding(action.id, keybindings))}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
