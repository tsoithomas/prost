import { useTableStructure } from '../api/metadata';
import { useDdlStore } from '../stores/ddlStore';
import { AddColumnModal } from './AddColumnModal';
import { CreateIndexModal } from './CreateIndexModal';
import { EditColumnModal, type EditColumnSeed } from './EditColumnModal';

/**
 * Opens the *existing* DDL modals, pre-filled, for a change handed over via `ddlStore` — the path an
 * accepted AI suggestion takes (Phase 33). Nothing about the modals' behaviour changes: the same
 * server-rendered SQL preview, the same mutations, the same confirm gates. This only supplies the
 * initial values and the table structure they need, so a suggestion can be reviewed without the
 * table's structure tab being open.
 *
 * Mounted once in `AppLayout` — in both the desktop and mobile shells — like `CommandPalette`.
 */
export function DdlSuggestionHost() {
  const pending = useDdlStore((s) => s.pending);
  const closeDdl = useDdlStore((s) => s.closeDdl);

  // Hooks must run unconditionally; a null connection id keeps the query disabled until something
  // is pending, so mounting this host app-wide costs nothing.
  const { data: structure } = useTableStructure(
    pending?.connectionId ?? null,
    pending?.schema ?? '',
    pending?.table ?? '',
  );

  if (!pending) return null;
  const { connectionId, schema, table, change } = pending;
  const common = { open: true, onClose: closeDdl, connectionId, schema, table };

  if (change.kind === 'createIndex') {
    const { columns, unique, method, name } = change.request;
    return (
      <CreateIndexModal
        {...common}
        availableColumns={structure?.columns ?? []}
        initialColumns={columns}
        initialUnique={unique}
        {...(method != null ? { initialMethod: method } : {})}
        {...(name != null ? { initialName: name } : {})}
      />
    );
  }

  const operation = change.request.operation;
  if (operation.kind === 'addColumn') {
    return <AddColumnModal {...common} initialColumn={operation.column} />;
  }

  // The remaining suggestable operations are all in-place edits of one existing column.
  if (operation.kind === 'setNotNull' || operation.kind === 'setDefault' || operation.kind === 'changeType') {
    const col = structure?.columns.find((c) => c.name === operation.column);
    // Wait for the structure before rendering: `EditColumnModal` needs the column it's editing.
    if (!col) return null;
    return <EditColumnModal {...common} col={col} initialOperation={operation as EditColumnSeed} />;
  }

  return null;
}
