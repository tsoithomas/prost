import { useState } from 'react';
import { Breadcrumbs } from './Breadcrumbs';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import type { WorkspaceTab } from './WorkspaceTabBar';
import { TableView } from './TableView';
import { SqlEditorView } from './SqlEditorView';

const initialTabs: WorkspaceTab[] = [
  { id: 'users', label: 'users', kind: 'table' },
  { id: 'query-1', label: 'Query 1', kind: 'query' },
];

export function Workspace() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]!.id);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[next.length - 1]!.id);
      }
      return next;
    });
  }

  const breadcrumbSegments = activeTab
    ? ['PostgreSQL', 'Localhost', 'public', activeTab.label]
    : ['PostgreSQL', 'Localhost', 'public'];

  return (
    <>
      <Breadcrumbs segments={breadcrumbSegments} />
      <WorkspaceTabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} />
      {activeTab?.kind === 'table' ? <TableView /> : null}
      {activeTab?.kind === 'query' ? <SqlEditorView /> : null}
      {!activeTab ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-faint">No tabs open</div>
      ) : null}
    </>
  );
}
