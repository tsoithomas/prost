import { UnprocessableEntityException } from '@nestjs/common';
import type { AlterTableOperation, ColumnMetadata, ForeignKeyAction } from '@prost/shared-types';
import { FOREIGN_KEY_ACTIONS } from '@prost/shared-types';
import type { SqlFragment, TableRef } from '../types';

/** The `addForeignKey` operation, narrowed from the union. */
export type AddForeignKeyOp = Extract<AlterTableOperation, { kind: 'addForeignKey' }>;

const FK_ACTIONS = new Set<string>(FOREIGN_KEY_ACTIONS);

function assertAction(action: string | undefined, field: string): void {
  if (action !== undefined && !FK_ACTIONS.has(action)) {
    throw new UnprocessableEntityException(`Invalid ${field} action "${action}". Allowed: ${FOREIGN_KEY_ACTIONS.join(', ')}`);
  }
}

/**
 * Engine-neutral validation + name synthesis for an `addForeignKey` op (shared by PG and MySQL,
 * whose FK `ADD CONSTRAINT` grammar is identical). Verifies local columns exist and cardinality
 * matches; the referenced side is left for the database to reject (mapped by each driver's
 * `mapError`). A missing `constraintName` is synthesized as `<table>_<cols>_fkey`, length-clamped.
 */
export function normalizeAddForeignKey(ref: TableRef, op: AddForeignKeyOp, columns: ColumnMetadata[]): AddForeignKeyOp {
  const colNames = new Set(columns.map((c) => c.name));
  if (op.columns.length === 0) {
    throw new UnprocessableEntityException('A foreign key must reference at least one column');
  }
  if (op.columns.length !== op.referencedColumns.length) {
    throw new UnprocessableEntityException('Local and referenced column counts must match');
  }
  for (const c of op.columns) {
    if (!colNames.has(c)) throw new UnprocessableEntityException(`Column "${c}" does not exist`);
  }
  if (!op.referencedTable || op.referencedTable.trim() === '') {
    throw new UnprocessableEntityException('A referenced table is required');
  }
  assertAction(op.onDelete, 'ON DELETE');
  assertAction(op.onUpdate, 'ON UPDATE');

  let name = op.constraintName;
  if (!name) {
    const raw = `${ref.name}_${op.columns.join('_')}_fkey`;
    name = raw.length > 63 ? `${raw.slice(0, 59)}_fkey` : raw;
  }
  return { ...op, constraintName: name };
}

/** Rejects a `dropForeignKey` op with no constraint name (before it reaches the builder). */
export function normalizeDropForeignKey(op: Extract<AlterTableOperation, { kind: 'dropForeignKey' }>): void {
  if (!op.constraintName || op.constraintName.trim() === '') {
    throw new UnprocessableEntityException('A constraint name is required to drop a foreign key');
  }
}

/**
 * Builds the `ADD CONSTRAINT … FOREIGN KEY … REFERENCES …` clause (after `ALTER TABLE <t>`), shared
 * by PG and MySQL. `quote` and `qualify` are the driver's identifier-quoting + table-qualifying
 * functions, keeping the clause engine-neutral. Actions are validated keywords, never interpolated
 * user text. Assumes `op.constraintName` was populated by `normalizeAddForeignKey`.
 */
export function buildAddForeignKeyClause(
  op: AddForeignKeyOp,
  quote: (id: string) => string,
  qualify: (ref: TableRef) => string,
): SqlFragment {
  const cols = op.columns.map(quote).join(', ');
  const refCols = op.referencedColumns.map(quote).join(', ');
  const refTable = qualify({ namespace: op.referencedSchema ?? undefined, name: op.referencedTable });
  let sql = `ADD CONSTRAINT ${quote(op.constraintName!)} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;
  if (op.onDelete) sql += ` ON DELETE ${op.onDelete as ForeignKeyAction}`;
  if (op.onUpdate) sql += ` ON UPDATE ${op.onUpdate as ForeignKeyAction}`;
  return { sql, params: [] };
}
