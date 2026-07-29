import { useThemeStore } from '../../stores/themeStore';
import { KeybindingSettings } from '../KeybindingSettings';
import type { SectionProps } from './controls';

export function KeyboardSection({ save }: SectionProps) {
  const keybindings = useThemeStore((s) => s.keybindings);
  const setKeybindings = useThemeStore((s) => s.setKeybindings);

  return (
    <div className="flex flex-col gap-md">
      <p className="text-xs text-text-faint">Click a shortcut, then press the new key combination to rebind it.</p>
      <KeybindingSettings
        keybindings={keybindings}
        onChange={(next) => {
          setKeybindings(next);
          save({ keybindings: next });
        }}
      />
    </div>
  );
}
