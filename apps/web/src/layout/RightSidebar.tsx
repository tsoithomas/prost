import { Bot, PanelRightClose } from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from '@prost/ui';
import { ChatPanel } from '../ai/ChatPanel';
import { useResizableWidth } from '../hooks/useResizableWidth';
import { useAiStore } from '../stores/aiStore';
import { useConnectionStore } from '../stores/connectionStore';
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, useLayoutStore } from '../stores/layoutStore';

export function RightSidebar() {
  const open = useAiStore((s) => s.rightSidebarOpen);
  const setOpen = useAiStore((s) => s.setRightSidebarOpen);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const sidebarWidth = useLayoutStore((s) => s.rightSidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setRightSidebarWidth);
  const { isResizing, onPointerDown } = useResizableWidth({
    width: sidebarWidth,
    min: MIN_SIDEBAR_WIDTH,
    max: MAX_SIDEBAR_WIDTH,
    onResize: setSidebarWidth,
    side: 'right',
  });

  return (
    <aside
      className={clsx(
        'relative hidden shrink-0 flex-col border-l border-border bg-surface-sunken md:flex',
        !isResizing && 'transition-[width] duration-150',
        !open && 'w-12',
      )}
      style={open ? { width: sidebarWidth } : undefined}
    >
      {open ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize AI panel"
            onPointerDown={onPointerDown}
            className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
          />
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-md">
            <span className="flex items-center gap-sm text-sm font-semibold text-text">
              <Bot size={16} className="text-accent" />
              AI Chat
            </span>
            <IconButton aria-label="Collapse AI panel" title="Collapse AI panel" onClick={() => setOpen(false)}>
              <PanelRightClose size={16} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeConnectionId ? (
              <ChatPanel connectionId={activeConnectionId} />
            ) : (
              <p className="px-md py-lg text-center text-sm italic text-text-faint">
                Select a connection to use AI Chat.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="flex justify-center p-sm">
          <IconButton aria-label="Open AI panel" title="Open AI panel" onClick={() => setOpen(true)}>
            <Bot size={16} />
          </IconButton>
        </div>
      )}
    </aside>
  );
}
