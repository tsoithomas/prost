import { ShieldOff, X } from 'lucide-react';
import { IconButton } from '@prost/ui';
import { useConnections } from '../../api/connections';
import { useThemeStore } from '../../stores/themeStore';
import { match, type SectionProps } from './controls';

/**
 * Masked-column roster (Phase 39). Marking happens in the grid header menu; this is the one place to
 * review everything that's masked and clear it. The scope note is deliberate: masking is a redaction
 * convenience for sharing and exports, **not** access control, and the copy must not imply otherwise.
 */
export function PrivacySection({ save, query }: SectionProps) {
  const maskedColumns = useThemeStore((s) => s.maskedColumns);
  const setMaskedColumns = useThemeStore((s) => s.setMaskedColumns);
  const { data: connections = [] } = useConnections();

  const entries = Object.entries(maskedColumns).flatMap(([connectionId, tables]) =>
    Object.entries(tables).map(([table, columns]) => ({
      connectionId,
      connectionName: connections.find((c) => c.id === connectionId)?.name ?? connectionId,
      table,
      columns,
    })),
  );

  function unmask(connectionId: string, table: string, column: string) {
    const next = structuredClone(maskedColumns);
    const remaining = (next[connectionId]?.[table] ?? []).filter((c) => c !== column);
    if (remaining.length > 0) {
      next[connectionId]![table] = remaining;
    } else {
      delete next[connectionId]?.[table];
      if (Object.keys(next[connectionId] ?? {}).length === 0) delete next[connectionId];
    }
    setMaskedColumns(next);
    save({ maskedColumns: next });
  }

  if (!match('Masked columns sensitive data privacy', query)) return null;

  return (
    <div className="flex flex-col gap-lg">
      <div>
        <h3 className="mb-xs flex items-center gap-sm text-sm font-medium text-text">
          <ShieldOff size={15} className="text-text-faint" />
          Masked columns
        </h3>
        <p className="text-xs text-text-muted">
          Marked columns are redacted by the server when you browse a table and in CSV, JSON and SQL
          exports. Query results are never masked, and you can reveal a table&apos;s masked columns for
          a session from its toolbar — so this hides data from view, it does not restrict access to it.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm italic text-text-faint">
          Nothing is masked. Right-click a column header in a table and choose &ldquo;Mark
          sensitive&rdquo;.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {entries.map((entry, i) => (
            <div
              key={`${entry.connectionId}:${entry.table}`}
              className={i < entries.length - 1 ? 'border-b border-border' : undefined}
            >
              <div className="flex items-baseline gap-sm px-md pt-sm text-xs text-text-faint">
                <span className="font-medium text-text">{entry.connectionName}</span>
                <span className="font-mono">{entry.table}</span>
              </div>
              <ul className="flex flex-wrap gap-xs px-md pb-sm pt-xs">
                {entry.columns.map((column) => (
                  <li
                    key={column}
                    className="flex items-center gap-xs rounded-sm bg-surface-hover px-sm py-0.5 font-mono text-xs text-text"
                  >
                    {column}
                    <IconButton
                      aria-label={`Unmask ${entry.table}.${column}`}
                      title="Unmask"
                      className="h-4 w-4 max-md:h-6 max-md:w-6"
                      onClick={() => unmask(entry.connectionId, entry.table, column)}
                    >
                      <X size={11} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
