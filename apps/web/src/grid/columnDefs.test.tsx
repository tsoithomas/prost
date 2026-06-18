import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import { buildColumnDefs } from './columnDefs';

function col(name: string, dataType: string, isPrimaryKey = false): ColumnMetadata {
  return { name, dataType, nullable: true, isPrimaryKey };
}

const COLUMNS: ColumnMetadata[] = [
  col('id', 'integer', true),
  col('price', 'numeric'),
  col('active', 'boolean'),
  col('born', 'date'),
  col('created', 'timestamptz'),
  col('email', 'character varying'),
];

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
