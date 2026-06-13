import { StatusDot } from '@prost/ui';
import { useActiveConnection } from '../api/connections';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function StatusBar() {
  const activeConnection = useActiveConnection();
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const cursorPosition = useWorkspaceStore((state) => state.cursorPosition);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const showCursorPosition = activeTab?.kind === 'query' && cursorPosition !== null;

  return (
    <footer className="hidden h-6 shrink-0 items-center justify-between border-t border-border bg-surface-sunken px-md font-mono text-xs text-text-muted md:flex">
      <div className="flex items-center gap-md">
        <span className="font-medium text-accent">Prost v{__APP_VERSION__}</span>
        {showCursorPosition ? (
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-md">
        {activeConnection ? (
          <>
            <span>
              {activeConnection.database}@{activeConnection.host}:{activeConnection.port}
            </span>
            <span className="flex items-center gap-xs">
              <StatusDot variant="success" />
              Connected
            </span>
          </>
        ) : (
          <span className="flex items-center gap-xs">
            <StatusDot variant="neutral" />
            No connection
          </span>
        )}
      </div>
    </footer>
  );
}
