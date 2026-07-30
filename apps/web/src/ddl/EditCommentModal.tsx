import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button, IconButton, Modal, Surface } from '@prost/ui';
import { useDescribeObject } from '../api/ai';
import { useAlterTable } from '../api/ddl';
import { useDdlPreview } from '../api/ddlPreview';
import { apiErrorDetail } from '../lib/apiClient';
import { useAiStore } from '../stores/aiStore';

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  table: string;
  /** The column being documented; omit to document the table itself. */
  column?: string;
  /** The comment as it stands, so the field opens on what's already there. */
  current: string | null;
}

/**
 * Edits a native table/column comment (Phase 38). Documentation is still DDL, so it goes through the
 * same preview → confirm → execute path as every other schema change: the SQL below the field is
 * rendered by the server, and nothing is written until Apply. "Draft with AI" only fills the field.
 */
export function EditCommentModal({ open, onClose, connectionId, schema, table, column, current }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const alter = useAlterTable(connectionId, schema, table);
  const describe = useDescribeObject(connectionId);
  const selectedEndpointId = useAiStore((s) => s.selectedEndpointId);
  const selectedModel = useAiStore((s) => s.selectedModel);
  const aiReady = Boolean(selectedEndpointId && selectedModel);

  const target = column ? `column ${table}.${column}` : `table ${schema}.${table}`;
  const trimmed = text.trim();
  const previewBody = open
    ? {
        kind: 'alterTable' as const,
        request: {
          kind: 'setComment',
          schema,
          table,
          ...(column ? { columnName: column } : {}),
          comment: trimmed === '' ? null : trimmed,
        },
      }
    : null;
  const { sql: previewSql } = useDdlPreview(connectionId, previewBody);

  useEffect(() => {
    if (!open) return;
    setText(current ?? '');
    setError(null);
    alter.reset();
    describe.reset();
    // Re-seed whenever the modal opens on a different target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schema, table, column, current]);

  function apply(comment: string | null) {
    setError(null);
    alter.mutate(
      { kind: 'setComment', ...(column ? { columnName: column } : {}), comment },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(apiErrorDetail(err, 'Failed to save the comment.')),
      },
    );
  }

  function draft() {
    if (!selectedEndpointId || !selectedModel) return;
    setError(null);
    describe.mutate(
      { endpointId: selectedEndpointId, model: selectedModel, schema, table, ...(column ? { column } : {}) },
      {
        onSuccess: (res) => setText(res.comment),
        onError: (err) => setError(apiErrorDetail(err, 'Could not draft a description.')),
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit comment for ${target}`} hideTitle className="w-full max-w-[32rem] overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
        <span className="text-sm font-semibold text-text">
          Comment on <span className="font-mono">{column ? `${table}.${column}` : `${schema}.${table}`}</span>
        </span>
        <IconButton aria-label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-sm p-lg">
        <div className="flex items-center justify-between">
          <label htmlFor="object-comment" className="text-xs font-medium uppercase tracking-wider text-text-faint">
            Description
          </label>
          {aiReady ? (
            <Button variant="ghost" size="sm" onClick={draft} disabled={describe.isPending}>
              <Sparkles size={13} />
              {describe.isPending ? 'Drafting…' : 'Draft with AI'}
            </Button>
          ) : null}
        </div>
        <textarea
          id="object-comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What does this hold, and what is it for?"
          className="w-full resize-y rounded-sm border border-border bg-surface px-sm py-sm text-sm text-text focus:border-accent focus:outline-none"
        />
        {previewSql ? (
          <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-sm font-mono text-xs text-text-faint">
            {previewSql}
          </pre>
        ) : null}
        {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
      </div>

      <Surface level="raised" className="flex h-12 shrink-0 items-center justify-between border-t border-border px-lg">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => apply(null)}
          disabled={alter.isPending || current === null}
        >
          Clear comment
        </Button>
        <div className="flex items-center gap-sm">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => apply(trimmed === '' ? null : trimmed)}
            disabled={alter.isPending || trimmed === (current ?? '')}
          >
            Apply
          </Button>
        </div>
      </Surface>
    </Modal>
  );
}
