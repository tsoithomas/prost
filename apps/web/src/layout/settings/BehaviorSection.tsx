import type { BehaviorPreferences } from '@prost/shared-types';
import { useConnections } from '../../api/connections';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { match, SettingSwitch, type SectionProps } from './controls';

export function BehaviorSection({ save, query }: SectionProps) {
  const behavior = useThemeStore((s) => s.behavior);
  const setBehaviorPrefs = useThemeStore((s) => s.setBehaviorPrefs);
  const { data: connections = [] } = useConnections();

  function updateBehavior(patch: Partial<BehaviorPreferences>) {
    const next = { ...behavior, ...patch };
    setBehaviorPrefs(next);
    save({ behavior: next });
  }

  function handleTransaction(on: boolean) {
    updateBehavior({ transactionByDefault: on });
    // Keep the runtime "Run as transaction" default in sync.
    useWorkspaceStore.getState().setTransactionalDefault(on);
  }

  const startup = behavior.startupConnection ?? 'last';

  return (
    <div className="flex flex-col gap-lg">
      {match('Run in a transaction by default', query) ? (
        <SettingSwitch
          label="Run in a transaction by default"
          description="New query tabs start with the transaction toggle on."
          checked={behavior.transactionByDefault ?? false}
          onChange={handleTransaction}
        />
      ) : null}
      {match('Confirm writes and DDL', query) ? (
        <SettingSwitch
          label="Confirm writes"
          description="Ask before running a statement that modifies data or schema."
          checked={behavior.confirmWrites ?? false}
          onChange={(on) => updateBehavior({ confirmWrites: on })}
        />
      ) : null}
      {match('Startup connection', query) ? (
        <div>
          <p className="mb-xs text-xs font-medium text-text-muted">Startup connection</p>
          <select
            value={startup}
            aria-label="Startup connection"
            onChange={(e) => updateBehavior({ startupConnection: e.target.value })}
            className="w-full rounded-md border border-border bg-surface px-sm py-1 text-xs text-text"
          >
            <option value="last">Restore last used</option>
            <option value="none">None</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
