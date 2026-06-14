import { useState } from 'react';
import { Code, Pencil, Trash2, X } from 'lucide-react';
import type { SnippetDto } from '@prost/shared-types';
import { IconButton, Input, Surface } from '@prost/ui';
import { useDeleteSnippet, useSnippets, useUpdateSnippet } from '../api/snippets';
import { useConfirm } from '../hooks/useConfirm';

export interface SnippetListProps {
  onSelect: (sql: string) => void;
}

/** Connected component — manages its own data fetching and mutations. */
export function SnippetList({ onSelect }: SnippetListProps) {
  const { data: snippets, isLoading, isError } = useSnippets();
  const deleteSnippet = useDeleteSnippet();
  const updateSnippet = useUpdateSnippet();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  async function handleDelete(snippet: SnippetDto) {
    const confirmed = await confirm({
      title: 'Delete snippet',
      description: `Delete snippet "${snippet.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    deleteSnippet.mutate(snippet.id);
  }

  function startRename(snippet: SnippetDto) {
    setRenamingId(snippet.id);
    setRenameValue(snippet.name);
  }

  function submitRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    updateSnippet.mutate(
      { id, name: trimmed },
      { onSuccess: () => setRenamingId(null) },
    );
  }

  if (isLoading) {
    return <p className="px-sm py-2 text-xs italic text-text-faint">Loading snippets…</p>;
  }

  if (isError) {
    return <p className="px-sm py-2 text-xs text-danger">Failed to load snippets.</p>;
  }

  if (!snippets || snippets.length === 0) {
    return (
      <p className="px-sm py-2 text-xs italic text-text-faint">
        No saved snippets yet. Save a query from the editor to get started.
      </p>
    );
  }

  return (
    <>
      <Surface level="raised" bordered className="flex flex-col overflow-hidden rounded-md">
        {snippets.map((snippet) => (
          <div
            key={snippet.id}
            className="group flex items-start gap-sm border-b border-border px-md py-sm last:border-b-0"
          >
            <Code size={14} className="mt-0.5 shrink-0 text-text-faint" />
            <div className="flex min-w-0 flex-1 flex-col">
              {renamingId === snippet.id ? (
                <div className="flex items-center gap-xs">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(snippet.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="h-6 text-xs"
                    autoFocus
                  />
                  <IconButton
                    aria-label="Cancel rename"
                    onClick={() => setRenamingId(null)}
                  >
                    <X size={12} />
                  </IconButton>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(snippet.body)}
                  className="truncate text-left text-xs font-medium text-text hover:text-accent"
                  title={snippet.body}
                >
                  {snippet.name}
                </button>
              )}
              {renamingId !== snippet.id ? (
                <span className="truncate font-mono text-xs text-text-faint" title={snippet.body}>
                  {snippet.body}
                </span>
              ) : null}
            </div>
            {renamingId !== snippet.id ? (
              <div className="flex shrink-0 gap-xs opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton
                  aria-label={`Rename ${snippet.name}`}
                  onClick={() => startRename(snippet)}
                >
                  <Pencil size={12} />
                </IconButton>
                <IconButton
                  aria-label={`Delete ${snippet.name}`}
                  onClick={() => handleDelete(snippet)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </div>
            ) : null}
          </div>
        ))}
      </Surface>
      {confirmDialog}
    </>
  );
}
