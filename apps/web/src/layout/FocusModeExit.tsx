import { Minimize2 } from 'lucide-react';
import { IconButton, Tooltip } from '@prost/ui';
import { formatChord, resolveBinding } from '../keybindings';
import { useThemeStore } from '../stores/themeStore';

export interface FocusModeExitProps {
  onExit: () => void;
}

/**
 * The single floating affordance to leave focus mode (Phase 40) — `Escape` also works, but this is
 * the discoverable path when the chord is forgotten or remapped. Rendered on top of whatever the
 * active tab shows, in both shells.
 */
export function FocusModeExit({ onExit }: FocusModeExitProps) {
  const keybindings = useThemeStore((s) => s.keybindings);
  const chord = formatChord(resolveBinding('toggle-focus-mode', keybindings));
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-40">
      <Tooltip content={`Exit focus mode (${chord} or Esc)`}>
        <IconButton
          aria-label="Exit focus mode"
          variant="solid"
          onClick={onExit}
          className="pointer-events-auto shadow-lg"
        >
          <Minimize2 size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
