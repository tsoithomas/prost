import { LogOut, Plug } from 'lucide-react';
import { Button, Surface } from '@prost/ui';
import { ThemeSettings } from '../layout/ThemeSettings';
import { mockConnections } from '../mocks/connections';

export interface MobileSettingsViewProps {
  onManageConnections: () => void;
}

export function MobileSettingsView({ onManageConnections }: MobileSettingsViewProps) {
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
          <Surface level="raised" bordered className="flex flex-col overflow-hidden rounded-md">
            {mockConnections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center gap-sm border-b border-border px-md py-sm last:border-b-0"
              >
                <Plug size={16} className="text-text-faint" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-text">{connection.name}</span>
                  <span className="truncate font-mono text-xs text-text-faint">
                    {connection.host}:{connection.port}
                  </span>
                </div>
              </div>
            ))}
          </Surface>
          <Button variant="secondary" size="sm" className="mt-sm w-full justify-center" onClick={onManageConnections}>
            Manage Connections
          </Button>
        </section>

        <section>
          <Button variant="ghost" size="sm" className="w-full justify-center !text-danger">
            <LogOut size={14} />
            Sign Out
          </Button>
        </section>
      </div>
    </div>
  );
}
