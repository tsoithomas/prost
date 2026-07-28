import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { X } from 'lucide-react';
import type { ColumnMetadata } from '@prost/shared-types';
import { Button, IconButton, Surface } from '@prost/ui';
import { useImportPreview } from '../api/import';
import { useCsvImport } from './useCsvImport';
import { useConfirm } from '../hooks/useConfirm';
import { apiErrorDetail } from '../lib/apiClient';

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnMetadata[];
  /** Called after a successful import so the caller can refresh the grid. */
  onImported?: () => void;
}

/** One source CSV column and the target table column it maps to (`''` = skip). */
interface Mapping {
  sourceIndex: number;
  header: string;
  target: string;
}

const SKIP = '';

/** Case-insensitive exact-name match to seed a sensible default mapping. */
function guessTarget(header: string, columns: ColumnMetadata[]): string {
  const match = columns.find((c) => c.name.toLowerCase() === header.trim().toLowerCase());
  return match?.name ?? SKIP;
}

export function ImportModal({ open, onClose, connectionId, schema, table, columns, onImported }: Props) {
  const [step, setStep] = useState<'file' | 'map' | 'importing' | 'done'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [sample, setSample] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [previewSql, setPreviewSql] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useImportPreview(connectionId);
  const csvImport = useCsvImport(connectionId, schema, table);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    if (!open) {
      setStep('file');
      setFile(null);
      setHasHeader(true);
      setSample([]);
      setMappings([]);
      setIssues([]);
      setPreviewSql(null);
      setFormError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && step !== 'importing') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);

  const mapped = useMemo(() => mappings.filter((m) => m.target !== SKIP), [mappings]);
  const targetColumns = mapped.map((m) => m.target);
  const sourceIndices = mapped.map((m) => m.sourceIndex);

  if (!open) return null;

  function handleFile(f: File) {
    setFile(f);
    setFormError(null);
    Papa.parse<string[]>(f, {
      preview: 20,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const rows = results.data;
        if (rows.length === 0) {
          setFormError('The file appears to be empty.');
          return;
        }
        const first = rows[0]!;
        setSample(rows);
        setMappings(
          first.map((cell, i) => ({
            sourceIndex: i,
            header: hasHeader ? String(cell ?? `column_${i + 1}`) : `column_${i + 1}`,
            target: hasHeader ? guessTarget(String(cell ?? ''), columns) : SKIP,
          })),
        );
        setStep('map');
      },
      error: (err: Error) => setFormError(err.message),
    });
  }

  /** The sample data rows (header excluded) projected into the mapped target-column order. */
  function projectedSample(limit: number): unknown[][] {
    const dataRows = hasHeader ? sample.slice(1) : sample;
    return dataRows.slice(0, limit).map((row) => sourceIndices.map((i) => row[i] ?? null));
  }

  function runPreview() {
    if (mapped.length === 0) {
      setFormError('Map at least one column.');
      return;
    }
    setFormError(null);
    preview.mutate(
      { schema, table, columns: targetColumns, sampleRows: projectedSample(10) },
      {
        onSuccess: (res) => {
          setIssues(res.issues);
          setPreviewSql(res.sql || null);
        },
        onError: (err) => setFormError(apiErrorDetail(err, 'Preview failed.')),
      },
    );
  }

  async function handleImport() {
    if (!file || mapped.length === 0 || issues.length > 0) return;
    const ok = await confirm({
      title: 'Import rows',
      description: `Insert rows from "${file.name}" into ${schema}.${table}? This cannot be undone.`,
      confirmLabel: 'Import',
    });
    if (!ok) return;

    setStep('importing');
    try {
      await csvImport.run(file, { columns: targetColumns, sourceIndices, hasHeader });
      setStep('done');
      onImported?.();
    } catch {
      // The hook records the error message; keep the modal open on the importing screen to show it.
    }
  }

  const selectCls =
    'h-8 w-full rounded-sm border border-border bg-surface px-sm text-xs text-text focus:border-accent focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-md md:items-center">
      <Surface level="overlay" bordered className="flex max-h-[85vh] w-full max-w-[40rem] flex-col overflow-hidden rounded-lg shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
          <span className="text-sm font-semibold text-text">Import CSV — {schema}.{table}</span>
          <IconButton aria-label="Close" onClick={onClose} disabled={step === 'importing'}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-lg overflow-y-auto p-lg">
          {step === 'file' ? (
            <div className="flex flex-col gap-md">
              <label className="flex items-center gap-sm text-sm text-text">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} aria-label="First row is a header" />
                First row is a header
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="CSV file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                className="text-sm text-text"
              />
            </div>
          ) : null}

          {step === 'map' ? (
            <div className="flex flex-col gap-md">
              <p className="text-xs text-text-faint">Map each CSV column to a target column, or leave it as “skip”.</p>
              <div className="overflow-hidden rounded-sm border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-sunken text-text-faint">
                    <tr>
                      <th className="px-sm py-1.5 text-left font-medium">CSV column</th>
                      <th className="px-sm py-1.5 text-left font-medium">Sample</th>
                      <th className="px-sm py-1.5 text-left font-medium">Target column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.sourceIndex} className="border-t border-border">
                        <td className="px-sm py-1.5 font-mono text-text">{m.header}</td>
                        <td className="max-w-[10rem] truncate px-sm py-1.5 font-mono text-text-faint">
                          {String((hasHeader ? sample[1] : sample[0])?.[m.sourceIndex] ?? '')}
                        </td>
                        <td className="px-sm py-1.5">
                          <select
                            className={selectCls}
                            value={m.target}
                            aria-label={`Target for ${m.header}`}
                            onChange={(e) => {
                              const target = e.target.value;
                              setMappings((prev) => prev.map((x) => (x.sourceIndex === m.sourceIndex ? { ...x, target } : x)));
                              setPreviewSql(null);
                              setIssues([]);
                            }}
                          >
                            <option value={SKIP}>— skip —</option>
                            {columns.map((c) => (
                              <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {issues.length > 0 ? (
                <ul className="list-inside list-disc text-xs text-danger" role="alert">
                  {issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              ) : null}

              {previewSql ? (
                <div>
                  <span className="mb-xs block text-xs font-medium uppercase tracking-wider text-text-faint">Statement shape</span>
                  <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-md font-mono text-xs text-text">{previewSql}</pre>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 'importing' || step === 'done' ? (
            <div className="flex flex-col gap-md">
              <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${csvImport.progress.totalBytes > 0 ? Math.round((csvImport.progress.processedBytes / csvImport.progress.totalBytes) * 100) : (step === 'done' ? 100 : 0)}%` }}
                />
              </div>
              <p className="text-sm text-text">
                {csvImport.progress.inserted.toLocaleString()} row{csvImport.progress.inserted === 1 ? '' : 's'} inserted
                {step === 'done' ? ' — done.' : '…'}
              </p>
              {csvImport.error ? <p className="text-xs text-danger" role="alert">{csvImport.error}</p> : null}
            </div>
          ) : null}

          {formError ? <p className="text-xs text-danger" role="alert">{formError}</p> : null}
        </div>

        <Surface level="raised" className="flex h-16 shrink-0 items-center justify-end gap-md border-t border-border px-lg">
          {step === 'map' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep('file')}>Back</Button>
              {previewSql && issues.length === 0 ? (
                <Button variant="primary" size="sm" onClick={handleImport}>Import</Button>
              ) : (
                <Button variant="primary" size="sm" onClick={runPreview} disabled={preview.isPending || mapped.length === 0}>
                  {preview.isPending ? 'Checking…' : 'Preview'}
                </Button>
              )}
            </>
          ) : null}
          {step === 'importing' ? <Button variant="ghost" size="sm" onClick={() => csvImport.cancel()}>Cancel</Button> : null}
          {step === 'file' || step === 'done' ? (
            <Button variant={step === 'done' ? 'primary' : 'ghost'} size="sm" onClick={onClose}>
              {step === 'done' ? 'Done' : 'Cancel'}
            </Button>
          ) : null}
        </Surface>
      </Surface>
      {confirmDialog}
    </div>
  );
}
