import { Breadcrumbs } from './Breadcrumbs';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { TableView } from './TableView';
import { SqlEditorView } from './SqlEditorView';
import { useActiveConnection } from '../api/connections';
import { useConnectionStore } from '../stores/connectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function Workspace() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const newQueryTab = useWorkspaceStore((state) => state.newQueryTab);
  const setTabViewMode = useWorkspaceStore((state) => state.setTabViewMode);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeConnection = useActiveConnection();

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  const connectionLabel = activeConnection?.name ?? 'No connection';
  const breadcrumbSegments =
    activeTab?.kind === 'table' && activeTab.schema
      ? [connectionLabel, activeTab.schema, activeTab.label]
      : [connectionLabel];

  return (
    <>
      <Breadcrumbs segments={breadcrumbSegments} />
      <WorkspaceTabBar tabs={tabs} activeTabId={activeTabId} onSelect={selectTab} onClose={closeTab} onNewTab={newQueryTab} />
      {activeTab?.kind === 'table' && activeTab.schema && activeTab.table && activeConnectionId ? (
        <TableView
          connectionId={activeConnectionId}
          schema={activeTab.schema}
          table={activeTab.table}
          viewMode={activeTab.viewMode ?? 'rows'}
          onViewModeChange={(vm) => setTabViewMode(activeTab.id, vm)}
        />
      ) : null}
      {activeTab?.kind === 'query' ? <SqlEditorView /> : null}
      {!activeTab ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-faint">No tabs open</div>
      ) : null}
    </>
  );
}
