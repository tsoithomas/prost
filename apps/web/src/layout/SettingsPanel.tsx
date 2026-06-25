import { useEffect, useRef } from 'react';
import { LogOut } from 'lucide-react';
import { Surface } from '@prost/ui';
import { useAuthStore } from '../stores/authStore';
import { ThemeSettings } from './ThemeSettings';

export interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clear);

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
      <div className="mt-md flex flex-col gap-xs border-t border-border pt-md">
        {user ? (
          <p className="truncate text-xs text-text-faint">
            Signed in as <span className="text-text-muted">{user.email}</span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            clearAuth();
            onClose();
          }}
          className="inline-flex cursor-pointer items-center justify-center gap-xs text-xs text-danger hover:underline"
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </Surface>
  );
}
