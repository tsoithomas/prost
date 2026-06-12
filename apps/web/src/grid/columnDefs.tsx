import { Calendar, Hash, KeyRound, Type } from 'lucide-react';
import type { ColDef } from 'ag-grid-community';
import type { CustomHeaderProps } from 'ag-grid-react';
import type { ColumnMetadata } from '@prost/shared-types';

const INTEGER_TYPES = new Set(['int2', 'int4', 'int8', 'smallint', 'integer', 'bigint', 'serial', 'bigserial']);
const DECIMAL_TYPES = new Set(['numeric', 'decimal', 'real', 'double precision', 'float4', 'float8']);
const TEMPORAL_TYPES = new Set(['timestamp', 'timestamptz', 'date', 'time', 'timetz']);

function dataTypeColorVar(dataType: string): string {
  const normalized = dataType.toLowerCase();
  if (INTEGER_TYPES.has(normalized)) return 'var(--color-data-number)';
  if (DECIMAL_TYPES.has(normalized)) return 'var(--color-data-decimal)';
  if (TEMPORAL_TYPES.has(normalized)) return 'var(--color-data-temporal)';
  return 'var(--color-data-string)';
}

function dataTypeIcon(dataType: string) {
  const normalized = dataType.toLowerCase();
  if (INTEGER_TYPES.has(normalized) || DECIMAL_TYPES.has(normalized)) return Hash;
  if (TEMPORAL_TYPES.has(normalized)) return Calendar;
  return Type;
}

interface ColumnHeaderParams {
  dataType: string;
  isPrimaryKey: boolean;
}

function ColumnHeader({ displayName, dataType, isPrimaryKey }: CustomHeaderProps & ColumnHeaderParams) {
  const Icon = dataTypeIcon(dataType);
  return (
    <div className="flex items-center gap-xs overflow-hidden px-1 text-xs">
      {isPrimaryKey ? (
        <KeyRound size={12} className="shrink-0 text-accent" />
      ) : (
        <Icon size={12} className="shrink-0 text-text-faint" />
      )}
      <span className="truncate font-medium text-text">{displayName}</span>
      <span className="shrink-0 text-text-faint">{dataType}</span>
    </div>
  );
}

export function buildColumnDefs(columns: ColumnMetadata[]): ColDef[] {
  return columns.map((column) => ({
    field: column.name,
    headerComponent: ColumnHeader,
    headerComponentParams: {
      dataType: column.dataType,
      isPrimaryKey: column.isPrimaryKey,
    } satisfies ColumnHeaderParams,
    cellStyle: (params) =>
      params.value === null || params.value === undefined
        ? { color: 'var(--color-data-null)', fontStyle: 'italic' }
        : { color: dataTypeColorVar(column.dataType), fontStyle: 'normal' },
    valueFormatter: (params) =>
      params.value === null || params.value === undefined ? 'null' : String(params.value),
    resizable: true,
    sortable: true,
  }));
}
