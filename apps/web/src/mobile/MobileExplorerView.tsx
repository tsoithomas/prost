import { useState } from 'react';
import { Box } from 'lucide-react';
import { StatusDot } from '@prost/ui';
import { useActiveConnection } from '../api/connections';
import { connectionEndpoint } from '../connection/connectionDisplay';
import { useMetadata } from '../api/metadata';
import { CreateTableModal } from '../ddl/CreateTableModal';
import { SchemaTree } from '../explorer/SchemaTree';
import { openSchemaObject, selectedObjectKey } from '../explorer/objectNavigation';
import { useConnectionStore } from '../stores/connectionStore';
import { usePinnedTablesStore } from '../stores/pinnedTablesStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export interface MobileExplorerViewProps {
  /** Called after a table is opened, so the shell can switch to the editor/results tab. */
  onSelectTable?: () => void;
}

export function MobileExplorerView({ onSelectTable }: MobileExplorerViewProps) {
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeConnection = useActiveConnection();
  const { data: schemas, isLoading, isError } = useMetadata(activeConnectionId);
  const workspaceTabs = useWorkspaceStore((state) => state.tabs);
  const activeWorkspaceTabId = useWorkspaceStore((state) => state.activeTabId);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const openObject = useWorkspaceStore((state) => state.openObject);
  const openOverview = useWorkspaceStore((state) => state.openOverview);
  const pinnedByConnection = usePinnedTablesStore((state) => state.pinned);
  const togglePinned = usePinnedTablesStore((state) => state.toggle);
  const pinnedKeys = new Set(activeConnectionId ? pinnedByConnection[activeConnectionId] ?? [] : []);

  const [createTableState, setCreateTableState] = useState<{ open: boolean; schema: string }>({
    open: false,
    schema: '',
  });

  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId);
  const selectedTable =
    activeWorkspaceTab?.kind === 'table' && activeWorkspaceTab.schema
      ? `${activeWorkspaceTab.schema}.${activeWorkspaceTab.table}`
      : null;
  const selectedObject = selectedObjectKey(activeWorkspaceTab);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-xs border-b border-border bg-surface-sunken px-md py-1.5">
        <Box size={14} className="text-accent" />
        <span className="font-mono text-xs text-text-muted">
          {activeConnection ? connectionEndpoint(activeConnection) : 'No database'}
        </span>
        <span className="ml-auto flex items-center gap-xs text-xs text-text-faint">
          <StatusDot variant={activeConnectionId ? 'success' : 'neutral'} />
          {activeConnectionId ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-sm pb-2">
        {activeConnectionId === null ? (
          <p className="px-sm py-2 text-xs italic text-text-faint">
            No active connection. Use "New Connection" to get started.
          </p>
        ) : isLoading ? (
          <p className="px-sm py-2 text-xs italic text-text-faint">Loading schemas…</p>
        ) : isError ? (
          <p className="px-sm py-2 text-xs text-danger">Failed to load schemas.</p>
        ) : (
          <SchemaTree
            schemas={schemas ?? []}
            selectedTable={selectedTable}
            selectedObject={selectedObject}
            onSelectTable={(table) => {
              openTable(table.schema, table.name, 'rows');
              onSelectTable?.();
            }}
            onOpenStructure={(table) => {
              openTable(table.schema, table.name, 'structure');
              onSelectTable?.();
            }}
            onSelectObject={(object) => {
              openSchemaObject({ openTable, openObject }, object);
              onSelectTable?.();
            }}
            onNewTable={(schema) => setCreateTableState({ open: true, schema })}
            onOpenOverview={(schema) => {
              openOverview(schema);
              onSelectTable?.();
            }}
            hasSchemas={activeConnection?.capabilities.hasSchemas ?? true}
            writable={!activeConnection?.capabilities.readOnly}
            pinnedKeys={pinnedKeys}
            onTogglePin={
              activeConnectionId
                ? (table) => togglePinned(activeConnectionId, `${table.schema}.${table.name}`)
                : undefined
            }
          />
        )}
      </div>
      {activeConnectionId ? (
        <CreateTableModal
          open={createTableState.open}
          onClose={() => setCreateTableState((s) => ({ ...s, open: false }))}
          onSuccess={(schema, table) => {
            openTable(schema, table, 'rows');
            onSelectTable?.();
          }}
          connectionId={activeConnectionId}
          initialSchema={createTableState.schema}
          schemas={(schemas ?? []).map((s) => s.name)}
        />
      ) : null}
    </div>
  );
}
