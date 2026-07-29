import {
  BOOLEAN_DISPLAYS,
  DATE_FORMATS,
  GRID_DENSITIES,
  NULL_DISPLAYS,
  PAGE_SIZES,
  type BooleanDisplay,
  type DateFormat,
  type GridDensity,
  type GridDisplayPreferences,
  type NullDisplay,
  type PageSize,
} from '@prost/shared-types';
import { useThemeStore } from '../../stores/themeStore';
import { SegmentedGroup } from '../SegmentedGroup';
import { match, SettingSwitch, type SectionProps } from './controls';

const densityLabels: Record<GridDensity, string> = { compact: 'Compact', normal: 'Normal', comfortable: 'Comfortable' };
const nullLabels: Record<NullDisplay, string> = {
  null: 'null',
  parens: '(null)',
  blank: '(blank)',
  upper: 'NULL',
  symbol: '␀',
};
const booleanLabels: Record<BooleanDisplay, string> = { truefalse: 'true / false', check: '✓ / ✗', onezero: '1 / 0' };
const dateLabels: Record<DateFormat, string> = { iso: 'ISO 8601', friendly: 'Friendly', relative: 'Relative' };

/** Full IANA zone list where the runtime supports it (falls back to just Local/UTC). */
const TIME_ZONES: string[] = (() => {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn('timeZone').filter((z) => z !== 'UTC') : [];
  } catch {
    return [];
  }
})();

/** A tiny non-interactive grid mock so density changes are visible without leaving Settings. */
function GridPreview() {
  const rows = [
    ['1', 'ada@example.com', '42'],
    ['2', 'grace@example.com', '7'],
  ];
  return (
    <div className="overflow-hidden rounded-md border border-border" style={{ fontSize: 'var(--grid-font-size)' }}>
      <div className="flex items-center bg-surface-sunken font-medium text-text-muted" style={{ padding: 'var(--grid-spacing)' }}>
        <span className="flex-1">id</span>
        <span className="flex-[2]">email</span>
        <span className="flex-1">orders</span>
      </div>
      {rows.map((r) => (
        <div key={r[0]} className="flex items-center border-t border-border text-text" style={{ padding: 'var(--grid-spacing)' }}>
          <span className="flex-1" style={{ color: 'var(--color-data-number)' }}>{r[0]}</span>
          <span className="flex-[2]" style={{ color: 'var(--color-data-string)' }}>{r[1]}</span>
          <span className="flex-1" style={{ color: 'var(--color-data-number)' }}>{r[2]}</span>
        </div>
      ))}
    </div>
  );
}

export function GridSection({ save, query }: SectionProps) {
  const gridDensity = useThemeStore((s) => s.gridDensity);
  const grid = useThemeStore((s) => s.grid);
  const setGridDensity = useThemeStore((s) => s.setGridDensity);
  const setGridPrefs = useThemeStore((s) => s.setGridPrefs);

  function updateGrid(patch: Partial<GridDisplayPreferences>) {
    const next = { ...grid, ...patch };
    setGridPrefs(next);
    save({ grid: next });
  }
  function handleDensity(density: GridDensity) {
    setGridDensity(density);
    save({ gridDensity: density });
  }

  return (
    <div className="flex flex-col gap-lg">
      {match('Grid density', query) ? (
        <div className="flex flex-col gap-sm">
          <SegmentedGroup
            label="Grid density"
            options={GRID_DENSITIES}
            value={gridDensity}
            render={(d) => densityLabels[d]}
            onSelect={handleDensity}
          />
          <GridPreview />
        </div>
      ) : null}
      {match('NULL display', query) ? (
        <SegmentedGroup
          label="NULL display"
          options={NULL_DISPLAYS}
          value={grid.nullDisplay ?? 'null'}
          render={(n) => nullLabels[n]}
          onSelect={(nullDisplay: NullDisplay) => updateGrid({ nullDisplay })}
        />
      ) : null}
      {match('Boolean display', query) ? (
        <SegmentedGroup
          label="Boolean display"
          options={BOOLEAN_DISPLAYS}
          value={grid.booleanDisplay ?? 'truefalse'}
          render={(b) => booleanLabels[b]}
          onSelect={(booleanDisplay: BooleanDisplay) => updateGrid({ booleanDisplay })}
        />
      ) : null}
      {match('Date format', query) ? (
        <SegmentedGroup
          label="Date format"
          options={DATE_FORMATS}
          value={grid.dateFormat ?? 'iso'}
          render={(d) => dateLabels[d]}
          onSelect={(dateFormat: DateFormat) => updateGrid({ dateFormat })}
        />
      ) : null}
      {match('Time zone', query) ? (
        <div>
          <p className="mb-xs text-xs font-medium text-text-muted">Time zone</p>
          <p className="mb-sm text-xs text-text-faint">Applied to dates rendered as “Local” and to int-timestamp columns shown as dates.</p>
          <select
            value={grid.timeZone ?? 'local'}
            aria-label="Time zone"
            onChange={(e) => updateGrid({ timeZone: e.target.value })}
            className="w-full rounded-md border border-border bg-surface px-sm py-1 text-xs text-text"
          >
            <option value="local">Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
            <option value="UTC">UTC</option>
            {TIME_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {match('Rows per page', query) ? (
        <SegmentedGroup
          label="Rows per page"
          options={PAGE_SIZES}
          value={grid.pageSize ?? 100}
          render={(n) => String(n)}
          onSelect={(pageSize: PageSize) => updateGrid({ pageSize })}
        />
      ) : null}
      {match('Row numbers', query) ? (
        <SettingSwitch
          label="Show row numbers"
          checked={grid.rowNumbers ?? false}
          onChange={(rowNumbers) => updateGrid({ rowNumbers })}
        />
      ) : null}
    </div>
  );
}
