import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConnectionStore } from '../stores/connectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { MobileSettingsView, type MobileSettingsViewProps } from './MobileSettingsView';

let perfSupported = true;

vi.mock('../api/connections', () => ({ useConnections: () => ({ data: [] }) }));
vi.mock('../api/databaseEngines', () => ({
  useEngineDescriptor: () => ({
    supportsSessionMonitoring: false,
    supportsPerfInsights: perfSupported,
  }),
}));
vi.mock('../explorer/QueryHistoryList', () => ({ QueryHistoryList: () => null }));
vi.mock('../explorer/SnippetList', () => ({ SnippetList: () => null }));

const props = (): MobileSettingsViewProps => ({
  onManageConnections: vi.fn(),
  onSelectHistoryQuery: vi.fn(),
  onSelectSnippet: vi.fn(),
  onOpenSessions: vi.fn(),
  onOpenAudit: vi.fn(),
  onOpenPerformance: vi.fn(),
});

afterEach(() => {
  perfSupported = true;
  useConnectionStore.setState({ activeConnectionId: 'c1' });
  useWorkspaceStore.setState({
    tabs: [{ id: 'query-1', label: 'Query 1', kind: 'query', sql: 'SELECT 1', result: null }],
    activeTabId: 'query-1',
  });
});

describe('MobileSettingsView performance entry', () => {
  it('opens the connection-bound performance workspace when supported', async () => {
    useConnectionStore.setState({ activeConnectionId: 'c1' });
    const callbacks = props();
    render(<MobileSettingsView {...callbacks} />);

    await userEvent.click(screen.getByRole('button', { name: 'Performance' }));

    expect(useWorkspaceStore.getState().activeTabId).toBe('performance:c1');
    expect(callbacks.onOpenPerformance).toHaveBeenCalled();
  });

  it('hides the entry when the descriptor capability is off', () => {
    perfSupported = false;
    render(<MobileSettingsView {...props()} />);
    expect(screen.queryByRole('button', { name: 'Performance' })).not.toBeInTheDocument();
  });
});
