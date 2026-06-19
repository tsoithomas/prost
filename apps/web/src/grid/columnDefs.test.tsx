import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import { buildColumnDefs, classifyDataType } from './columnDefs';

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
});
