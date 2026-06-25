import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { KEYBINDING_ACTIONS, type KeybindingMap } from '@prost/shared-types';
import { Button } from '@prost/ui';
import { chordFromEvent, findKeybindingConflicts, formatChord, resolveBinding } from '../keybindings';

export interface KeybindingSettingsProps {
  keybindings: KeybindingMap;
  onChange: (next: KeybindingMap) => void;
}

export function KeybindingSettings({ keybindings, onChange }: KeybindingSettingsProps) {
  const [recording, setRecording] = useState<string | null>(null);

  // While recording, the next valid keydown becomes the chord for the selected action.
  useEffect(() => {
    if (!recording) return;
    function handle(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return; // a bare modifier press — keep listening
      onChange({ ...keybindings, [recording!]: chord });
      setRecording(null);
    }
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [recording, keybindings, onChange]);

  const conflicts = findKeybindingConflicts(keybindings);
  const conflictedActions = new Set(conflicts.flatMap((c) => c.actionIds));
  const isDefault = Object.keys(keybindings).length === 0;

  return (
    <div>
      <p className="mb-xs text-xs font-medium text-text-muted">Keyboard shortcuts</p>
      <div className="flex flex-col gap-1">
        {KEYBINDING_ACTIONS.map((action) => {
          const chord = resolveBinding(action.id, keybindings);
          const conflicted = conflictedActions.has(action.id);
          return (
            <div key={action.id} className="flex items-center gap-sm">
              <span className="flex-1 text-xs text-text">{action.label}</span>
              <button
                type="button"
                onClick={() => setRecording(action.id)}
                className={clsx(
                  'min-w-[5rem] rounded-sm border px-sm py-1 text-center font-mono text-xs transition-colors',
                  recording === action.id
                    ? 'border-accent text-accent'
                    : conflicted
                      ? 'border-danger text-danger'
                      : 'border-border text-text-muted hover:bg-surface-hover hover:text-text',
                )}
              >
                {recording === action.id ? 'Press keys…' : formatChord(chord)}
              </button>
            </div>
          );
        })}
      </div>
      {conflicts.length > 0 ? (
        <p className="mt-xs text-xs text-danger">
          Conflict: the same shortcut is bound to multiple actions.
        </p>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="mt-sm"
        disabled={isDefault}
        onClick={() => onChange({})}
      >
        Reset to defaults
      </Button>
    </div>
  );
}
