import type { SchemaObjectSummary } from '@prost/shared-types';
import type { useWorkspaceStore, WorkspaceTab } from '../stores/workspaceStore';

type Store = ReturnType<typeof useWorkspaceStore.getState>;

/**
 * Routes a schema-tree object click: views and materialized views are relations, so they open in
 * the grid read-only (reusing `openTable`); every other kind opens a read-only definition panel.
 * Shared by the desktop Sidebar and the mobile explorer so the policy lives in one place.
 */
export function openSchemaObject(store: Pick<Store, 'openTable' | 'openObject'>, object: SchemaObjectSummary): void {
  const schema = object.schema ?? 'main';
  if (object.kind === 'view' || object.kind === 'materializedView') {
    store.openTable(schema, object.name, 'rows');
  } else {
    store.openObject(schema, object.kind, object.name);
  }
}

/** The composite `schema.name` key of the active object/view tab, for highlighting in the tree. */
export function selectedObjectKey(activeTab: WorkspaceTab | undefined): string | null {
  if (activeTab?.kind === 'object' && activeTab.schema && activeTab.objectName) {
    return `${activeTab.schema}.${activeTab.objectName}`;
  }
  return null;
}
