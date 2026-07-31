import { describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ValueFormatterParams } from 'ag-grid-community';
import type { ColumnMetadata } from '@prost/shared-types';
import {
  applyRenderMode,
  availableRenderModes,
  buildColumnDefs,
  classifyDataType,
  DateCell,
  formatUnixTimestamp,
  isLongTextType,
  splitDateParts,
} from './columnDefs';
import type { CustomCellRendererProps } from 'ag-grid-react';

/** Invokes a ColDef's valueFormatter with a bare `{ value }` (the only field these formatters read). */
function fmt(def: { valueFormatter?: unknown }, value: unknown): string {
  return (def.valueFormatter as (p: ValueFormatterParams) => string)({ value } as ValueFormatterParams);
}

/** Invokes a ColDef's cellStyle function with a bare `{ value }` and returns the resolved style. */
function sty(def: { cellStyle?: unknown }, value: unknown): Record<string, unknown> {
  return (def.cellStyle as (p: { value: unknown }) => Record<string, unknown>)({ value });
}

function col(name: string, dataType: string, isPrimaryKey = false): ColumnMetadata {
  return { name, dataType, nullable: true, isPrimaryKey, autoIncrement: false, defaultValue: null };
}

const COLUMNS: ColumnMetadata[] = [
  col('id', 'integer', true),
  col('price', 'numeric'),
  col('active', 'boolean'),
  col('born', 'date'),
  col('created', 'timestamptz'),
  col('email', 'character varying'),
];

describe('classifyDataType', () => {
  it('groups all integer spellings together (the int/bigint inconsistency fix)', () => {
    for (const t of ['int', 'int4', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint', 'serial', 'int(11)']) {
      expect(classifyDataType(t)).toBe('integer');
    }
  });

  it('groups string types (length-qualified and engine variants) together', () => {
    for (const t of ['varchar', 'varchar(255)', 'character varying', 'text', 'char(10)', 'uuid', 'json', 'TEXT']) {
      expect(classifyDataType(t)).toBe('string');
    }
  });

  it('classifies decimals, booleans, and temporals by category', () => {
    for (const t of ['numeric', 'decimal(10,2)', 'double precision', 'float', 'real', 'money']) {
      expect(classifyDataType(t)).toBe('decimal');
    }
    for (const t of ['bool', 'boolean', 'bit']) expect(classifyDataType(t)).toBe('boolean');
    for (const t of ['date', 'timestamp', 'timestamptz', 'datetime', 'time', 'year']) {
      expect(classifyDataType(t)).toBe('temporal');
    }
  });
});

describe('buildColumnDefs editor selection', () => {
  it('chooses a type-aware editor per column when editable', () => {
    const defs = buildColumnDefs(COLUMNS, true);
    const byField = Object.fromEntries(defs.map((d) => [d.field, d]));

    expect(byField.id!.cellEditor).toBe('agNumberCellEditor');
    expect(byField.price!.cellEditor).toBe('agNumberCellEditor');
    expect(byField.active!.cellEditor).toBe('agSelectCellEditor');
    expect(byField.active!.cellEditorParams).toEqual({ values: [true, false, null] });
    expect(byField.born!.cellEditor).toBe('agDateStringCellEditor');
    // timestamps and bounded varchar keep the default (single-line text) editor.
    expect(byField.created!.cellEditor).toBeUndefined();
    expect(byField.email!.cellEditor).toBeUndefined();
  });

  it('detects long/unbounded text-ish types', () => {
    for (const t of ['text', 'longtext', 'mediumtext', 'TINYTEXT', 'citext', 'jsonb', 'xml']) {
      expect(isLongTextType(t)).toBe(true);
    }
    for (const t of ['varchar(80)', 'character varying', 'integer', 'timestamp', 'boolean']) {
      expect(isLongTextType(t)).toBe(false);
    }
  });

  it('uses the floating multiline editor for text/longtext/json columns', () => {
    const defs = buildColumnDefs([col('bio', 'text'), col('doc', 'jsonb'), col('name', 'varchar(80)')], true);
    const byField = Object.fromEntries(defs.map((d) => [d.field, d]));

    expect(byField.bio!.cellEditor).toBe('agLargeTextCellEditor');
    expect(byField.bio!.cellEditorPopup).toBe(true);
    expect(byField.doc!.cellEditor).toBe('agLargeTextCellEditor');
    // A short, bounded varchar stays on the default single-line editor.
    expect(byField.name!.cellEditor).toBeUndefined();
  });

  it('assigns no editors and marks cells non-editable when the result is read-only', () => {
    const defs = buildColumnDefs(COLUMNS, false);
    for (const def of defs) {
      expect(def.editable).toBe(false);
      expect(def.cellEditor).toBeUndefined();
    }
  });

  it('uses a two-state (asc→desc) sort cycle', () => {
    for (const def of buildColumnDefs(COLUMNS, false)) {
      expect(def.sortingOrder).toEqual(['asc', 'desc']);
    }
  });
});

describe('render-as formatting', () => {
  it('renders ISO 8601 with the selected zone offset', () => {
    expect(formatUnixTimestamp(1700000000, 'iso', 'UTC')).toBe('2023-11-14T22:13:20+00:00');
    expect(formatUnixTimestamp(1700000000000, 'iso', 'UTC')).toBe('2023-11-14T22:13:20+00:00');
    // Tokyo is UTC+9 → later wall-clock time and a +09:00 offset.
    expect(formatUnixTimestamp(1700000000, 'iso', 'Asia/Tokyo')).toBe('2023-11-15T07:13:20+09:00');
  });

  it('renders FRIENDLY as a readable string in the configured zone', () => {
    expect(formatUnixTimestamp(1700000000, 'friendly', 'UTC')).toBe('2023-11-14 22:13:20 UTC');
    // Abbrev varies by ICU (JST/GMT+9); assert the wall-clock part in the +9 zone.
    expect(formatUnixTimestamp(1700000000, 'friendly', 'Asia/Tokyo')).toMatch(/^2023-11-15 07:13:20 \S+/);
  });

  it('honors the date format when rendering an int timestamp as a date', () => {
    // 'relative' for a 2023 timestamp reads as "... years ago".
    expect(formatUnixTimestamp(1700000000, 'relative', 'UTC')).toMatch(/ago|year/);
  });

  it('returns non-numeric input unchanged rather than a bogus date', () => {
    expect(formatUnixTimestamp('not-a-number')).toBe('not-a-number');
  });

  it('renders int/boolean as boolean, defaulting to true/false (nonzero = true)', () => {
    expect(applyRenderMode(1, 'boolean')).toBe('true');
    expect(applyRenderMode(0, 'boolean')).toBe('false');
    expect(applyRenderMode(2, 'boolean')).toBe('true');
    expect(applyRenderMode(true, 'boolean')).toBe('true');
  });

  it('render-as-boolean observes the booleanDisplay option', () => {
    expect(applyRenderMode(1, 'boolean', { booleanDisplay: 'check' })).toBe('✓');
    expect(applyRenderMode(0, 'boolean', { booleanDisplay: 'check' })).toBe('✗');
    expect(applyRenderMode(1, 'boolean', { booleanDisplay: 'onezero' })).toBe('1');
    expect(applyRenderMode(0, 'boolean', { booleanDisplay: 'onezero' })).toBe('0');
  });

  it('applyRenderMode leaves json values as their raw string (the popup prettifies)', () => {
    expect(applyRenderMode('{"a":1}', 'json')).toBe('{"a":1}');
  });

  it('offers date/boolean for integers, json for strings, nothing otherwise', () => {
    expect(availableRenderModes('integer')).toEqual(['date', 'boolean']);
    expect(availableRenderModes('string')).toEqual(['json']);
    expect(availableRenderModes('temporal')).toEqual([]);
  });
});

describe('buildColumnDefs render overrides', () => {
  const overridden = buildColumnDefs(COLUMNS, true, {
    renderOverrides: { id: 'date', active: 'boolean' },
    display: { booleanDisplay: 'check', timeZone: 'UTC' },
  });
  const byField = Object.fromEntries(overridden.map((d) => [d.field, d]));

  it('applies the override transform through the column valueFormatter (observing display options)', () => {
    // Default date format is ISO 8601 with the selected zone's offset (UTC here).
    expect(fmt(byField.id!, 1700000000)).toBe('2023-11-14T22:13:20+00:00');
    // The boolean override honors the grid's booleanDisplay ('check').
    expect(fmt(byField.active!, 0)).toBe('✗');
    expect(fmt(byField.active!, 1)).toBe('✓');
  });

  it('still renders null as "null" regardless of override', () => {
    expect(fmt(byField.id!, null)).toBe('null');
  });

  it('colors an int-rendered-as-boolean cell green for true / red for false', () => {
    expect(sty(byField.active!, 1).color).toBe('var(--color-success)');
    expect(sty(byField.active!, 0).color).toBe('var(--color-danger)');
    // A column overridden to date is not boolean-colored.
    expect(sty(byField.id!, 1700000000).color).not.toBe('var(--color-success)');
  });

  it('disables editing (and the editor) for an overridden column even when editable', () => {
    expect(byField.id!.editable).toBe(false);
    expect(byField.id!.cellEditor).toBeUndefined();
    // A non-overridden column keeps its editor.
    expect(byField.price!.editable).toBe(true);
    expect(byField.price!.cellEditor).toBe('agNumberCellEditor');
  });
});

describe('date part coloring', () => {
  it('splits an ISO string into date/time/offset', () => {
    expect(splitDateParts('2023-11-14T22:13:20+00:00')).toEqual({
      date: '2023-11-14',
      time: '22:13:20',
      tz: '+00:00',
      iso: true,
    });
    expect(splitDateParts('2026-07-29T15:24:00-04:00')?.tz).toBe('-04:00');
  });

  it('splits a friendly string into date/time/zone', () => {
    expect(splitDateParts('2023-11-14 22:13:20 UTC')).toEqual({
      date: '2023-11-14',
      time: '22:13:20',
      tz: 'UTC',
      iso: false,
    });
    expect(splitDateParts('2023-11-15 07:13:20 GMT+9')?.tz).toBe('GMT+9');
  });

  it('returns null for non-date text', () => {
    expect(splitDateParts('2 years ago')).toBeNull();
    expect(splitDateParts('not a date')).toBeNull();
  });

  it('DateCell color-codes an ISO value (date + T + time + offset)', () => {
    const { container } = render(
      <DateCell {...({ valueFormatted: '2023-11-14T22:13:20+00:00' } as CustomCellRendererProps)} />,
    );
    expect(container.textContent).toBe('2023-11-14T22:13:20+00:00');
    expect(container.querySelectorAll('span[style]').length).toBe(4);
  });

  it('DateCell color-codes a friendly value (date + time + zone)', () => {
    const { container } = render(
      <DateCell {...({ valueFormatted: '2023-11-14 22:13:20 UTC' } as CustomCellRendererProps)} />,
    );
    expect(container.textContent).toBe('2023-11-14 22:13:20 UTC');
    // date, time, zone → 3 color-coded spans (the separators are plain spaces).
    expect(container.querySelectorAll('span[style]').length).toBe(3);
  });

  it('DateCell renders plain text for a non-date value', () => {
    const { container } = render(
      <DateCell {...({ valueFormatted: '2 years ago' } as CustomCellRendererProps)} />,
    );
    expect(container.textContent).toBe('2 years ago');
    expect(container.querySelectorAll('span[style]').length).toBe(0);
  });

  it('a date-rendering column wires the DateCell renderer', () => {
    const defs = buildColumnDefs(COLUMNS, false, { renderOverrides: { id: 'date' } });
    const byField = Object.fromEntries(defs.map((d) => [d.field, d]));
    expect(byField.id!.cellRenderer).toBe(DateCell);
    expect(byField.created!.cellRenderer).toBe(DateCell); // native timestamptz
    expect(byField.email!.cellRenderer).toBeUndefined();
  });
});

describe('buildColumnDefs boolean coloring', () => {
  const defs = buildColumnDefs(COLUMNS, false);
  const byField = Object.fromEntries(defs.map((d) => [d.field, d]));

  it('colors a native boolean column by truthiness', () => {
    expect(sty(byField.active!, true).color).toBe('var(--color-success)');
    expect(sty(byField.active!, 'f').color).toBe('var(--color-danger)');
    expect(sty(byField.active!, null).color).toBe('var(--color-data-null)');
  });

  it('leaves non-boolean columns on their data-type color', () => {
    expect(sty(byField.email!, 'x').color).not.toBe('var(--color-success)');
  });
});

describe('ColumnHeader — click to sort', () => {
  // Minimal AG Grid Column stub: only the members ColumnHeader touches.
  function makeColumn(initial: 'asc' | 'desc' | null) {
    return {
      getSort: () => initial,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  function renderHeader(
    column: ReturnType<typeof makeColumn>,
    props: { progressSort?: () => void; enableSorting?: boolean } = {},
  ) {
    const def = buildColumnDefs([col('email', 'character varying')], false)[0]!;
    const Header = def.headerComponent as ComponentType<Record<string, unknown>>;
    return render(
      <Header
        {...(def.headerComponentParams as Record<string, unknown>)}
        displayName="email"
        column={column}
        enableSorting={props.enableSorting ?? true}
        progressSort={props.progressSort ?? (() => {})}
      />,
    );
  }

  it('calls progressSort when a sortable header is clicked', async () => {
    const progressSort = vi.fn();
    renderHeader(makeColumn(null), { progressSort });
    await userEvent.click(screen.getByText('email'));
    expect(progressSort).toHaveBeenCalledTimes(1);
  });

  it('does not sort when sorting is disabled', async () => {
    const progressSort = vi.fn();
    renderHeader(makeColumn(null), { progressSort, enableSorting: false });
    await userEvent.click(screen.getByText('email'));
    expect(progressSort).not.toHaveBeenCalled();
  });

  it('renders the arrow matching the column sort direction (none when unsorted)', () => {
    const asc = renderHeader(makeColumn('asc'));
    expect(asc.container.querySelector('[aria-label="sorted ascending"]')).not.toBeNull();
    asc.unmount();

    const desc = renderHeader(makeColumn('desc'));
    expect(desc.container.querySelector('[aria-label="sorted descending"]')).not.toBeNull();
    desc.unmount();

    const none = renderHeader(makeColumn(null));
    expect(none.container.querySelector('[aria-label="sorted ascending"]')).toBeNull();
    expect(none.container.querySelector('[aria-label="sorted descending"]')).toBeNull();
  });
});

describe('buildColumnDefs masking (Phase 39)', () => {
  it('makes a masked column read-only even on an editable result', () => {
    const defs = buildColumnDefs(COLUMNS, true, { masked: new Set(['price']) });
    const byField = Object.fromEntries(defs.map((d) => [d.field, d]));

    // You cannot blind-write over a mask token, so no editor is attached either.
    expect(byField.price!.editable).toBe(false);
    expect(byField.price!.cellEditor).toBeUndefined();
    // Unmasked columns on the same table stay editable.
    expect(byField.id!.editable).toBe(true);
    expect(byField.id!.cellEditor).toBe('agNumberCellEditor');
  });

  it('is a no-op when nothing is masked', () => {
    const defs = buildColumnDefs(COLUMNS, true, { masked: new Set() });
    expect(defs.every((d) => d.editable)).toBe(true);
  });
});
