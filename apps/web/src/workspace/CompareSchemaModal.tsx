import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, Modal, Surface } from '@prost/ui';
import { useConnections } from '../api/connections';
import { useMetadata } from '../api/metadata';
import { FormField } from '../components/FormField';

export interface CompareSchemaModalProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  onCompare: (compareConnectionId: string, compareSchema: string) => void;
}

const selectClass =
  'h-9 w-full rounded-sm border border-border bg-surface px-sm text-sm text-text focus:border-accent focus:outline-none';

/** Picks the other side of a schema comparison — any connection (including this one) and one of its schemas. */
export function CompareSchemaModal({ open, onClose, connectionId, schema, onCompare }: CompareSchemaModalProps) {
  const { data: connections } = useConnections();
  const [targetConnectionId, setTargetConnectionId] = useState('');
  const { data: targetSchemas } = useMetadata(targetConnectionId || null);
  const [targetSchema, setTargetSchema] = useState('');

  const schemaNames = useMemo(() => (targetSchemas ?? []).map((s) => s.name), [targetSchemas]);

  useEffect(() => {
    if (!open) {
      setTargetConnectionId('');
      setTargetSchema('');
    }
  }, [open]);

  // Default the target schema once its list loads — prefer a different schema than the source when
  // comparing within the same connection (comparing a schema to itself is trivially identical).
  useEffect(() => {
    if (schemaNames.length === 0) return;
    const preferred = schemaNames.find((name) => !(targetConnectionId === connectionId && name === schema));
    setTargetSchema(preferred ?? schemaNames[0]!);
  }, [schemaNames, targetConnectionId, connectionId, schema]);

  const canCompare = targetConnectionId !== '' && targetSchema !== '';

  function handleCompare() {
    if (!canCompare) return;
    onCompare(targetConnectionId, targetSchema);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Compare Schemas" hideTitle className="w-full max-w-[28rem] overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
        <span className="text-sm font-semibold text-text">Compare Schemas</span>
        <IconButton aria-label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-lg p-lg">
        <p className="text-xs text-text-faint">
          Compare <span className="font-mono text-text">{schema}</span> against another connection's schema — live,
          in memory, same engine only.
        </p>

        <FormField label="Connection">
          <select
            value={targetConnectionId}
            onChange={(e) => setTargetConnectionId(e.target.value)}
            className={selectClass}
            aria-label="Connection to compare against"
          >
            <option value="">Select a connection…</option>
            {(connections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Schema">
          <select
            value={targetSchema}
            onChange={(e) => setTargetSchema(e.target.value)}
            className={selectClass}
            aria-label="Schema to compare against"
            disabled={targetConnectionId === ''}
          >
            {schemaNames.length === 0 ? <option value="">—</option> : null}
            {schemaNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <Surface level="raised" className="flex h-16 shrink-0 items-center justify-end gap-md border-t border-border px-lg">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleCompare} disabled={!canCompare}>
          Compare
        </Button>
      </Surface>
    </Modal>
  );
}
