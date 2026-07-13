import { useEffect } from 'react';
import { ArrowRight, CornerDownLeft } from 'lucide-react';

/** One relational-navigation action offered on a grid cell (forward or reverse FK). */
export interface CellMenuItem {
  label: string;
  direction: 'forward' | 'reverse';
  onSelect: () => void;
}

export interface CellMenuState {
  x: number;
  y: number;
  items: CellMenuItem[];
}

interface Props {
  /** The open menu (position + actions), or null when closed. */
  state: CellMenuState | null;
  onClose: () => void;
}

/**
 * A custom right-click / long-press menu offering FK relational navigation on a grid cell. AG Grid
 * Community has no context-menu API, so this mirrors the `ColumnRenderMenu` pattern (fixed-positioned,
 * closes on any outside click / another context-menu / Escape).
 */
export function CellContextMenu({ state, onClose }: Props) {
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      className="fixed z-50 min-w-[200px] overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item, i) => {
        const Icon = item.direction === 'forward' ? ArrowRight : CornerDownLeft;
        return (
          <button
            key={`${item.direction}:${item.label}:${i}`}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <Icon size={13} className="shrink-0 text-text-faint" />
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
