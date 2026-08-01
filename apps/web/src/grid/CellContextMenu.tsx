import { useEffect } from 'react';
import { ArrowRight, Copy, CornerDownLeft, Filter, X } from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * One action offered on a grid cell's right-click / long-press menu — either an FK
 * relational-navigation target (`direction` set) or a generic action (copy/filter/set-null,
 * Phase 40, `kind` set). `separatorBefore` draws a divider above the item, so the generic actions
 * can visually group ahead of any FK entries.
 */
export interface CellMenuItem {
  label: string;
  onSelect: () => void;
  direction?: 'forward' | 'reverse';
  kind?: 'copy' | 'filter' | 'setNull';
  separatorBefore?: boolean;
}

export interface CellMenuState {
  x: number;
  y: number;
  items: CellMenuItem[];
}

const KIND_ICON: Record<NonNullable<CellMenuItem['kind']>, ComponentType<{ size?: number; className?: string }>> = {
  copy: Copy,
  filter: Filter,
  setNull: X,
};

function iconFor(item: CellMenuItem): ComponentType<{ size?: number; className?: string }> {
  if (item.kind) return KIND_ICON[item.kind];
  return item.direction === 'forward' ? ArrowRight : CornerDownLeft;
}

interface Props {
  /** The open menu (position + actions), or null when closed. */
  state: CellMenuState | null;
  onClose: () => void;
}

/**
 * A custom right-click / long-press menu offering generic cell actions (copy/filter/set-null,
 * Phase 40) plus FK relational navigation, on a grid cell. AG Grid Community has no context-menu
 * API, so this mirrors the `ColumnRenderMenu` pattern (fixed-positioned, closes on any outside
 * click / another context-menu / Escape).
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
        const Icon = iconFor(item);
        return (
          <div key={`${item.kind ?? item.direction}:${item.label}:${i}`}>
            {item.separatorBefore ? <div className="my-1 h-px bg-border" /> : null}
            <button
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
          </div>
        );
      })}
    </div>
  );
}
