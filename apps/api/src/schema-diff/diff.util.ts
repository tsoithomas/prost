import type {
  AlterTableOperation,
  ColumnDiff,
  ColumnMetadata,
  DiffStatus,
  ForeignKeyAction,
  ForeignKeyDiff,
  ForeignKeyMetadata,
  IndexDiff,
  IndexMetadata,
  NewColumn,
  SchemaDiff,
  SchemaDiffChange,
  SchemaRef,
  TableDiff,
} from '@prost/shared-types';

/** One table's full live shape, gathered by `SchemaDiffService` via `MetadataService` before diffing. */
export interface ResolvedTable {
  name: string;
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
}

function columnsEqual(a: ColumnMetadata, b: ColumnMetadata): boolean {
  return (
    a.dataType === b.dataType &&
    a.nullable === b.nullable &&
    a.isPrimaryKey === b.isPrimaryKey &&
    a.autoIncrement === b.autoIncrement &&
    a.defaultValue === b.defaultValue
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function indexesEqual(a: IndexMetadata, b: IndexMetadata): boolean {
  return a.isUnique === b.isUnique && a.isPrimary === b.isPrimary && a.method === b.method && arraysEqual(a.columns, b.columns);
}

function foreignKeysEqual(a: ForeignKeyMetadata, b: ForeignKeyMetadata): boolean {
  return (
    a.referencedSchema === b.referencedSchema &&
    a.referencedTable === b.referencedTable &&
    arraysEqual(a.columns, b.columns) &&
    arraysEqual(a.referencedColumns, b.referencedColumns) &&
    (a.onDelete ?? null) === (b.onDelete ?? null) &&
    (a.onUpdate ?? null) === (b.onUpdate ?? null)
  );
}

interface KeyedDiff<T> {
  key: string;
  status: DiffStatus;
  left: T | null;
  right: T | null;
}

/** Unions two lists by key and classifies each entry `added`/`removed`/`changed`/`unchanged`. */
function diffByKey<T>(leftItems: T[], rightItems: T[], keyOf: (item: T) => string, equal: (a: T, b: T) => boolean): KeyedDiff<T>[] {
  const leftMap = new Map(leftItems.map((item) => [keyOf(item), item]));
  const rightMap = new Map(rightItems.map((item) => [keyOf(item), item]));
  const keys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort();
  return keys.map((key) => {
    const left = leftMap.get(key) ?? null;
    const right = rightMap.get(key) ?? null;
    const status: DiffStatus = left && right ? (equal(left, right) ? 'unchanged' : 'changed') : left ? 'removed' : 'added';
    return { key, status, left, right };
  });
}

/**
 * Diffs two live schemas' resolved tables (Phase 42). Status is expressed relative to `left` → `right`:
 * `added` exists only on the right, `removed` exists only on the left, `changed` differs on both. Pure
 * and DB-free — `SchemaDiffService` resolves the live reads via `MetadataService`; this only compares
 * the results, so it's unit-testable with plain fixtures.
 */
export function buildSchemaDiff(left: SchemaRef, leftTables: ResolvedTable[], right: SchemaRef, rightTables: ResolvedTable[]): SchemaDiff {
  const leftMap = new Map(leftTables.map((t) => [t.name, t]));
  const rightMap = new Map(rightTables.map((t) => [t.name, t]));
  const names = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort();

  const tables: TableDiff[] = names.map((name) => {
    const leftTable = leftMap.get(name) ?? null;
    const rightTable = rightMap.get(name) ?? null;

    const columns: ColumnDiff[] = diffByKey(leftTable?.columns ?? [], rightTable?.columns ?? [], (c) => c.name, columnsEqual).map(
      (d) => ({ name: d.key, status: d.status, left: d.left, right: d.right }),
    );
    const indexes: IndexDiff[] = diffByKey(leftTable?.indexes ?? [], rightTable?.indexes ?? [], (i) => i.name, indexesEqual).map(
      (d) => ({ name: d.key, status: d.status, left: d.left, right: d.right }),
    );
    const foreignKeys: ForeignKeyDiff[] = diffByKey(
      leftTable?.foreignKeys ?? [],
      rightTable?.foreignKeys ?? [],
      (f) => f.constraintName,
      foreignKeysEqual,
    ).map((d) => ({ constraintName: d.key, status: d.status, left: d.left, right: d.right }));

    const existsLeft = leftTable != null;
    const existsRight = rightTable != null;
    const hasMemberChange = [...columns, ...indexes, ...foreignKeys].some((d) => d.status !== 'unchanged');
    const status: DiffStatus = !existsLeft ? 'added' : !existsRight ? 'removed' : hasMemberChange ? 'changed' : 'unchanged';

    return { name, status, existsLeft, existsRight, columns, indexes, foreignKeys };
  });

  return { left, right, tables };
}

function columnMetadataToNewColumn(col: ColumnMetadata): NewColumn {
  return {
    name: col.name,
    type: col.dataType,
    nullable: col.nullable,
    isPrimaryKey: col.isPrimaryKey,
    autoIncrement: col.autoIncrement,
    ...(col.defaultValue != null ? { default: col.defaultValue } : {}),
  };
}

function foreignKeyAddOp(fk: ForeignKeyMetadata): AlterTableOperation {
  return {
    kind: 'addForeignKey',
    constraintName: fk.constraintName,
    columns: fk.columns,
    referencedSchema: fk.referencedSchema,
    referencedTable: fk.referencedTable,
    referencedColumns: fk.referencedColumns,
    ...(fk.onDelete ? { onDelete: fk.onDelete as ForeignKeyAction } : {}),
    ...(fk.onUpdate ? { onUpdate: fk.onUpdate as ForeignKeyAction } : {}),
  };
}

/**
 * Builds the change-set that reconciles the *other* side to match `source` (Phase 42 Decision 3): every
 * candidate is a typed `SchemaDiffChange`, re-validated by `DdlService.preview` in the service layer — this
 * function never renders SQL itself. Primary-key/auto-increment-only column differences and any change
 * that would require a structural table rebuild are surfaced in the diff but intentionally produce no
 * candidate here — additive and in-place ops only, matching the same-shapes-as-Phases-8/9/33 posture.
 */
export function buildMigrationCandidates(diff: SchemaDiff, source: 'left' | 'right'): SchemaDiffChange[] {
  const targetSchema = source === 'left' ? diff.right.schema : diff.left.schema;
  const changes: SchemaDiffChange[] = [];

  for (const table of diff.tables) {
    const existsInSource = source === 'left' ? table.existsLeft : table.existsRight;
    const existsInTarget = source === 'left' ? table.existsRight : table.existsLeft;

    if (existsInSource && !existsInTarget) {
      const columns = table.columns
        .map((c) => (source === 'left' ? c.left : c.right))
        .filter((c): c is ColumnMetadata => c != null)
        .map(columnMetadataToNewColumn);
      changes.push({ kind: 'createTable', request: { schema: targetSchema, table: table.name, columns } });

      for (const idx of table.indexes) {
        const src = source === 'left' ? idx.left : idx.right;
        if (src && !src.isPrimary) {
          changes.push({
            kind: 'createIndex',
            request: { schema: targetSchema, table: table.name, name: src.name, columns: src.columns, unique: src.isUnique, method: src.method },
          });
        }
      }
      for (const fk of table.foreignKeys) {
        const src = source === 'left' ? fk.left : fk.right;
        if (src) {
          changes.push({ kind: 'alterTable', request: { schema: targetSchema, table: table.name, operation: foreignKeyAddOp(src) } });
        }
      }
      continue;
    }

    if (!existsInSource && existsInTarget) {
      changes.push({ kind: 'dropTable', request: { schema: targetSchema, table: table.name } });
      continue;
    }

    if (!existsInSource && !existsInTarget) continue;

    for (const col of table.columns) {
      const src = source === 'left' ? col.left : col.right;
      const tgt = source === 'left' ? col.right : col.left;
      if (src && !tgt) {
        changes.push({
          kind: 'alterTable',
          request: { schema: targetSchema, table: table.name, operation: { kind: 'addColumn', column: columnMetadataToNewColumn(src) } },
        });
      } else if (!src && tgt) {
        changes.push({
          kind: 'alterTable',
          request: { schema: targetSchema, table: table.name, operation: { kind: 'dropColumn', column: tgt.name } },
        });
      } else if (src && tgt) {
        if (src.nullable !== tgt.nullable) {
          changes.push({
            kind: 'alterTable',
            request: { schema: targetSchema, table: table.name, operation: { kind: 'setNotNull', column: src.name, notNull: !src.nullable } },
          });
        }
        if (src.defaultValue !== tgt.defaultValue) {
          changes.push({
            kind: 'alterTable',
            request: { schema: targetSchema, table: table.name, operation: { kind: 'setDefault', column: src.name, default: src.defaultValue } },
          });
        }
        if (src.dataType !== tgt.dataType) {
          changes.push({
            kind: 'alterTable',
            request: { schema: targetSchema, table: table.name, operation: { kind: 'changeType', column: src.name, type: src.dataType } },
          });
        }
      }
    }

    for (const idx of table.indexes) {
      const src = source === 'left' ? idx.left : idx.right;
      const tgt = source === 'left' ? idx.right : idx.left;
      if (src?.isPrimary || tgt?.isPrimary) continue; // primary "indexes" follow the column PK flag, not createIndex/dropIndex.
      if (src && !tgt) {
        changes.push({
          kind: 'createIndex',
          request: { schema: targetSchema, table: table.name, name: src.name, columns: src.columns, unique: src.isUnique, method: src.method },
        });
      } else if (!src && tgt) {
        changes.push({ kind: 'dropIndex', request: { schema: targetSchema, table: table.name, index: tgt.name } });
      } else if (src && tgt) {
        // No generic ALTER INDEX — reconcile as an independently-reviewable drop, then create.
        changes.push({ kind: 'dropIndex', request: { schema: targetSchema, table: table.name, index: tgt.name } });
        changes.push({
          kind: 'createIndex',
          request: { schema: targetSchema, table: table.name, name: src.name, columns: src.columns, unique: src.isUnique, method: src.method },
        });
      }
    }

    for (const fk of table.foreignKeys) {
      const src = source === 'left' ? fk.left : fk.right;
      const tgt = source === 'left' ? fk.right : fk.left;
      if (src && !tgt) {
        changes.push({ kind: 'alterTable', request: { schema: targetSchema, table: table.name, operation: foreignKeyAddOp(src) } });
      } else if (!src && tgt) {
        changes.push({
          kind: 'alterTable',
          request: { schema: targetSchema, table: table.name, operation: { kind: 'dropForeignKey', constraintName: tgt.constraintName } },
        });
      } else if (src && tgt) {
        changes.push({
          kind: 'alterTable',
          request: { schema: targetSchema, table: table.name, operation: { kind: 'dropForeignKey', constraintName: tgt.constraintName } },
        });
        changes.push({ kind: 'alterTable', request: { schema: targetSchema, table: table.name, operation: foreignKeyAddOp(src) } });
      }
    }
  }

  return changes;
}

/** Whether applying `change` removes something — drives the change-set's unchecked-by-default state (§8). */
export function isDestructiveChange(change: SchemaDiffChange): boolean {
  if (change.kind === 'dropTable' || change.kind === 'dropIndex') return true;
  if (change.kind === 'alterTable') {
    return change.request.operation.kind === 'dropColumn' || change.request.operation.kind === 'dropForeignKey';
  }
  return false;
}
