import { describe, expect, it } from 'vitest';
import type { ValueFormatterParams } from 'ag-grid-community';
import type { ColumnMetadata } from '@prost/shared-types';
import {
  applyRenderMode,
  availableRenderModes,
  buildColumnDefs,
  classifyDataType,
  formatRenderBoolean,
  formatUnixTimestamp,
} from './columnDefs';

/** Invokes a ColDef's valueFormatter with a bare `{ value }` (the only field these formatters read). */
function fmt(def: { valueFormatter?: unknown }, value: unknown): string {
  return (def.valueFormatter as (p: ValueFormatterParams) => string)({ value } as ValueFormatterParams);
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
    // timestamps and text keep the default (text) editor.
    expect(byField.created!.cellEditor).toBeUndefined();
    expect(byField.email!.cellEditor).toBeUndefined();
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
  it('formats a Unix epoch (seconds or milliseconds) as a UTC string', () => {
    expect(formatUnixTimestamp(1700000000)).toBe('2023-11-14 22:13:20 UTC');
    expect(formatUnixTimestamp(1700000000000)).toBe('2023-11-14 22:13:20 UTC');
  });

  it('returns non-numeric input unchanged rather than a bogus date', () => {
    expect(formatUnixTimestamp('not-a-number')).toBe('not-a-number');
  });

  it('formats numbers and booleans as True/False', () => {
    expect(formatRenderBoolean(1)).toBe('True');
    expect(formatRenderBoolean(0)).toBe('False');
    expect(formatRenderBoolean(true)).toBe('True');
    expect(formatRenderBoolean(false)).toBe('False');
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
  const overridden = buildColumnDefs(COLUMNS, true, { renderOverrides: { id: 'date', active: 'boolean' } });
  const byField = Object.fromEntries(overridden.map((d) => [d.field, d]));

  it('applies the override transform through the column valueFormatter', () => {
    expect(fmt(byField.id!, 1700000000)).toBe('2023-11-14 22:13:20 UTC');
    expect(fmt(byField.active!, 0)).toBe('False');
  });

  it('still renders null as "null" regardless of override', () => {
    expect(fmt(byField.id!, null)).toBe('null');
  });

  it('disables editing (and the editor) for an overridden column even when editable', () => {
    expect(byField.id!.editable).toBe(false);
    expect(byField.id!.cellEditor).toBeUndefined();
    // A non-overridden column keeps its editor.
    expect(byField.price!.editable).toBe(true);
    expect(byField.price!.cellEditor).toBe('agNumberCellEditor');
  });
});
