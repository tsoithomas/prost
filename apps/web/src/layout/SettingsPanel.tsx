import { useEffect, useRef } from 'react';
import { Surface } from '@prost/ui';
import { ThemeSettings } from './ThemeSettings';

export interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <Surface
      ref={ref}
      level="overlay"
      bordered
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md p-md shadow-lg"
    >
      <ThemeSettings />
    </Surface>
  );
}
