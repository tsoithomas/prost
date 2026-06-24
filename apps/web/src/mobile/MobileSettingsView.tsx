import { LogOut, Plug } from 'lucide-react';
import { Button, Surface } from '@prost/ui';
import { useConnections } from '../api/connections';
import { connectionEndpoint } from '../connection/connectionDisplay';
import { QueryHistoryList } from '../explorer/QueryHistoryList';
import { SnippetList } from '../explorer/SnippetList';
import { ThemeSettings } from '../layout/ThemeSettings';
import { useAuthStore } from '../stores/authStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export interface MobileSettingsViewProps {
  onManageConnections: () => void;
  onSelectHistoryQuery: () => void;
  onSelectSnippet: () => void;
}

export function MobileSettingsView({ onManageConnections, onSelectHistoryQuery, onSelectSnippet }: MobileSettingsViewProps) {
  const { data: connections = [] } = useConnections();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const loadQuery = useWorkspaceStore((state) => state.loadQuery);
  const clearAuth = useAuthStore((state) => state.clear);

  function handleSelectHistory(sql: string) {
    loadQuery(sql);
    onSelectHistoryQuery();
  }

  return (
    <div className="flex-1 overflow-y-auto p-md">
      <div className="flex flex-col gap-lg">
        <section>
          <h2 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">Appearance</h2>
          <Surface level="raised" bordered className="rounded-md p-md">
            <ThemeSettings />
          </Surface>
        </section>

        <section>
          <h2 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">Connections</h2>
          {connections.length > 0 ? (
            <Surface level="raised" bordered className="flex flex-col overflow-hidden rounded-md">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className="flex items-center gap-sm border-b border-border px-md py-sm last:border-b-0"
                >
                  <Plug size={16} className="text-text-faint" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{connection.name}</span>
                    <span className="truncate font-mono text-xs text-text-faint">
                      {connectionEndpoint(connection)}
                    </span>
                  </div>
                </div>
              ))}
            </Surface>
          ) : (
            <p className="text-xs italic text-text-faint">No saved connections yet.</p>
          )}
          <Button variant="secondary" size="sm" className="mt-sm w-full justify-center" onClick={onManageConnections}>
            Manage Connections
          </Button>
        </section>

        <section>
          <h2 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">Recent Queries</h2>
          <QueryHistoryList connectionId={activeConnectionId} onSelect={handleSelectHistory} />
        </section>

        <section>
          <h2 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">Snippets</h2>
          <SnippetList onSelect={(sql) => { loadQuery(sql); onSelectSnippet(); }} />
        </section>

        <section>
          <Button variant="ghost" size="sm" className="w-full justify-center !text-danger" onClick={clearAuth}>
            <LogOut size={14} />
            Sign Out
          </Button>
        </section>
      </div>
    </div>
  );
}
