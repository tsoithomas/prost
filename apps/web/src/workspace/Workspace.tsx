import { Activity, ScrollText } from 'lucide-react';
import { Breadcrumbs } from './Breadcrumbs';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { TableView } from './TableView';
import { SqlEditorView } from './SqlEditorView';
import { DatabaseOverview } from './DatabaseOverview';
import { DefinitionPanel } from './DefinitionPanel';
import { SessionsPanel } from './SessionsPanel';
import { AuditPanel } from './AuditPanel';
import { useActiveConnection } from '../api/connections';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useConnectionStore } from '../stores/connectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function Workspace() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const closeOtherTabs = useWorkspaceStore((state) => state.closeOtherTabs);
  const closeTabsToLeft = useWorkspaceStore((state) => state.closeTabsToLeft);
  const closeTabsToRight = useWorkspaceStore((state) => state.closeTabsToRight);
  const closeAllTableTabs = useWorkspaceStore((state) => state.closeAllTableTabs);
  const reorderTab = useWorkspaceStore((state) => state.reorderTab);
  const newQueryTab = useWorkspaceStore((state) => state.newQueryTab);
  const setTabViewMode = useWorkspaceStore((state) => state.setTabViewMode);
  const openSessions = useWorkspaceStore((state) => state.openSessions);
  const openAudit = useWorkspaceStore((state) => state.openAudit);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeConnection = useActiveConnection();
  const sessionMonitoringSupported =
    useEngineDescriptor(activeConnectionId)?.supportsSessionMonitoring ?? false;

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  const connectionLabel = activeConnection?.name ?? 'No connection';
  const writable = !activeConnection?.capabilities.readOnly;
  const breadcrumbSegments =
    (activeTab?.kind === 'table' || activeTab?.kind === 'object') && activeTab.schema
      ? [connectionLabel, activeTab.schema, activeTab.label]
      : activeTab?.kind === 'overview' && activeTab.schema
        ? [connectionLabel, activeTab.schema]
        : [connectionLabel];

  const actionButtonClass =
    'flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text';
  const workspaceActions = activeConnectionId ? (
    <div className="flex items-center gap-1">
      {sessionMonitoringSupported ? (
        <button type="button" onClick={() => openSessions()} title="Database sessions" className={actionButtonClass}>
          <Activity size={13} />
          Sessions
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => openAudit(activeConnectionId)}
        title={`Audit log for ${connectionLabel}`}
        className={actionButtonClass}
      >
        <ScrollText size={13} />
        Audit
      </button>
    </div>
  ) : null;

  return (
    <>
      <Breadcrumbs segments={breadcrumbSegments} actions={workspaceActions} />
      <WorkspaceTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={selectTab}
        onClose={closeTab}
        onNewTab={newQueryTab}
        onReorder={reorderTab}
        onCloseOthers={closeOtherTabs}
        onCloseToLeft={closeTabsToLeft}
        onCloseToRight={closeTabsToRight}
        onCloseAllTables={closeAllTableTabs}
      />
      {activeTab?.kind === 'table' && activeTab.schema && activeTab.table && activeConnectionId ? (
        <TableView
          connectionId={activeConnectionId}
          schema={activeTab.schema}
          table={activeTab.table}
          viewMode={activeTab.viewMode ?? 'rows'}
          onViewModeChange={(vm) => setTabViewMode(activeTab.id, vm)}
        />
      ) : null}
      {activeTab?.kind === 'overview' && activeTab.schema && activeConnectionId ? (
        <DatabaseOverview connectionId={activeConnectionId} schema={activeTab.schema} writable={writable} />
      ) : null}
      {activeTab?.kind === 'object' && activeTab.schema && activeTab.objectKind && activeTab.objectName && activeConnectionId ? (
        <DefinitionPanel
          connectionId={activeConnectionId}
          schema={activeTab.schema}
          objectKind={activeTab.objectKind}
          objectName={activeTab.objectName}
        />
      ) : null}
      {activeTab?.kind === 'sessions' && activeConnectionId ? (
        <SessionsPanel connectionId={activeConnectionId} writable={writable} />
      ) : null}
      {activeTab?.kind === 'audit' ? <AuditPanel /> : null}
      {activeTab?.kind === 'query' ? <SqlEditorView /> : null}
      {!activeTab ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-faint">No tabs open</div>
      ) : null}
    </>
  );
}
