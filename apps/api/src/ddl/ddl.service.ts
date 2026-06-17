import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type {
  AlterTableOperation,
  AlterTableRequest,
  AlterTableResult,
  CreateIndexRequest,
  CreateIndexResult,
  CreateTableRequest,
  CreateTableResult,
  DropIndexRequest,
  DropIndexResult,
  NewColumn,
} from '@prost/shared-types';
import { PoolManager } from '../database/pool-manager.service';
import { PgDriver } from '../database/drivers/pg/pg-driver';
import { MetadataService } from '../metadata/metadata.service';

const ALLOWED_TYPES = new Set([
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'boolean', 'text', 'varchar', 'char',
  'real', 'double precision', 'numeric',
  'date', 'time', 'timestamp', 'timestamptz',
  'uuid', 'json', 'jsonb', 'bytea',
]);

// Only these accept a (n) or (n,m) length/precision modifier in Postgres.
const PARAMETERIZED_TYPES = new Set(['varchar', 'char', 'numeric']);

// Anchored to the full (normalized) string so stray characters can't slip through
// alongside an otherwise-valid type name.
const TYPE_PATTERN = /^([a-z]+(?: [a-z]+)*)(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/;

const SAFE_DEFAULT_PATTERN = /^(\d+|true|false|null|now\(\)|current_timestamp|gen_random_uuid\(\))$/i;

const ALLOWED_INDEX_METHODS = new Set(['btree', 'hash', 'gin', 'gist', 'brin']);

const USING_PATTERN = /^[a-z_][a-z0-9_]*(::([a-z][a-z0-9 ]*)(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)?$/i;

@Injectable()
export class DdlService {
  constructor(
    private readonly pool: PoolManager,
    private readonly driver: PgDriver,
    private readonly metadataService: MetadataService,
  ) {}

  async createTable(connectionId: string, req: CreateTableRequest): Promise<CreateTableResult> {
    if (req.columns.length === 0) {
      throw new UnprocessableEntityException('At least one column is required');
    }

    const names = req.columns.map((c) => c.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    if (duplicates.length > 0) {
      throw new UnprocessableEntityException(`Duplicate column name: "${duplicates[0]}"`);
    }

    const columns: NewColumn[] = req.columns.map((col) => {
      const type = this.validateType(col.type);
      const canonicalDefault = this.validateDefault(col.default);
      return {
        name: col.name,
        type,
        nullable: col.nullable,
        isPrimaryKey: col.isPrimaryKey,
        ...(canonicalDefault !== null ? { default: canonicalDefault } : {}),
      };
    });

    const frag = this.driver.buildCreateTable({ schema: req.schema, table: req.table, columns });

    try {
      await this.pool.run(connectionId, frag);
    } catch (err: unknown) {
      this.driver.mapError(err, { operation: 'createTable', detail: `Table "${req.schema}"."${req.table}" already exists` });
      throw err;
    }

    return { schema: req.schema, table: req.table, sql: frag.sql };
  }

  /** Returns the canonical (lowercased, whitespace-normalized) type that the create-table builder will emit verbatim. */
  private validateType(type: string): string {
    const normalized = type.trim().toLowerCase().replace(/\s+/g, ' ');
    const match = TYPE_PATTERN.exec(normalized);
    const base = match?.[1];
    const params = match?.[2];
    if (!base || !ALLOWED_TYPES.has(base)) {
      throw new UnprocessableEntityException(
        `Unsupported column type "${type}". Allowed types: ${[...ALLOWED_TYPES].join(', ')}`,
      );
    }
    if (params && !PARAMETERIZED_TYPES.has(base)) {
      throw new UnprocessableEntityException(`Type "${base}" does not accept a length/precision parameter`);
    }
    return `${base}${params ? params.replace(/\s+/g, '') : ''}`;
  }

  /** Returns the canonical (trimmed, lowercased) default that the create-table builder will emit verbatim, or `null` if none. */
  private validateDefault(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (!SAFE_DEFAULT_PATTERN.test(trimmed)) {
      throw new UnprocessableEntityException(
        `Unsupported default value "${value}". Allowed: now(), current_timestamp, gen_random_uuid(), true, false, null, or a non-negative integer`,
      );
    }
    return trimmed.toLowerCase();
  }

  async alterTable(connectionId: string, req: AlterTableRequest): Promise<AlterTableResult> {
    const structure = await this.metadataService.getTableStructure(connectionId, req.schema, req.table);
    const op = req.operation;
    const colNames = new Set(structure.columns.map((c) => c.name));

    let normalizedOp: AlterTableOperation;

    switch (op.kind) {
      case 'addColumn': {
        if (colNames.has(op.column.name)) {
          throw new ConflictException(`Column "${op.column.name}" already exists`);
        }
        const type = this.validateType(op.column.type);
        const canonDefault = this.validateDefault(op.column.default);
        const nullable = op.column.isPrimaryKey ? false : op.column.nullable;
        normalizedOp = {
          kind: 'addColumn',
          column: { ...op.column, type, nullable, ...(canonDefault !== null ? { default: canonDefault } : { default: undefined }) },
        };
        break;
      }
      case 'dropColumn': {
        if (!colNames.has(op.column)) {
          throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
        }
        const col = structure.columns.find((c) => c.name === op.column)!;
        if (col.isPrimaryKey) {
          throw new UnprocessableEntityException(`Cannot drop primary key column "${op.column}"`);
        }
        normalizedOp = op;
        break;
      }
      case 'setNotNull': {
        if (!colNames.has(op.column)) {
          throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
        }
        normalizedOp = op;
        break;
      }
      case 'setDefault': {
        if (!colNames.has(op.column)) {
          throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
        }
        let canonDefault: string | null = null;
        if (op.default !== null) {
          canonDefault = this.validateDefault(op.default);
          if (canonDefault === null) {
            throw new UnprocessableEntityException('Default value cannot be empty; pass null to drop the default');
          }
        }
        normalizedOp = { ...op, default: canonDefault };
        break;
      }
      case 'changeType': {
        if (!colNames.has(op.column)) {
          throw new UnprocessableEntityException(`Column "${op.column}" does not exist`);
        }
        const type = this.validateType(op.type);
        let using: string | undefined;
        if (op.using !== undefined) {
          const trimmed = op.using.trim();
          if (!USING_PATTERN.test(trimmed)) {
            throw new UnprocessableEntityException(
              `Unsupported USING expression "${op.using}". Allowed: identifier or identifier::type`,
            );
          }
          using = trimmed.toLowerCase();
        }
        normalizedOp = { kind: 'changeType', column: op.column, type, ...(using !== undefined ? { using } : {}) };
        break;
      }
      default:
        throw new UnprocessableEntityException('Unknown operation kind');
    }

    const frag = this.driver.buildAlterTable({ namespace: req.schema, name: req.table }, normalizedOp);

    try {
      await this.pool.run(connectionId, frag);
    } catch (err: unknown) {
      this.driver.mapError(err, { operation: 'alterTable' });
      throw err;
    }

    return { schema: req.schema, table: req.table, sql: frag.sql };
  }

  async createIndex(connectionId: string, req: CreateIndexRequest): Promise<CreateIndexResult> {
    const cols = await this.metadataService.getTableColumns(connectionId, req.schema, req.table);
    if (req.columns.length === 0) {
      throw new UnprocessableEntityException('At least one column is required for an index');
    }
    const colNames = new Set(cols.map((c) => c.name));
    for (const col of req.columns) {
      if (!colNames.has(col)) {
        throw new UnprocessableEntityException(`Column "${col}" does not exist`);
      }
    }

    const method = (req.method ?? 'btree').toLowerCase();
    if (!ALLOWED_INDEX_METHODS.has(method)) {
      throw new UnprocessableEntityException(
        `Unsupported index method "${req.method}". Allowed: ${[...ALLOWED_INDEX_METHODS].join(', ')}`,
      );
    }

    let name = req.name;
    if (!name) {
      const raw = `${req.table}_${req.columns.join('_')}_idx`;
      name = raw.length > 63 ? raw.slice(0, 59) + '_idx' : raw;
    }

    const frag = this.driver.buildCreateIndex(
      { schema: req.schema, table: req.table, columns: req.columns, unique: req.unique, name: req.name, method: req.method },
      name,
      method,
    );

    try {
      await this.pool.run(connectionId, frag);
    } catch (err: unknown) {
      this.driver.mapError(err, { operation: 'createIndex' });
      throw err;
    }

    return { schema: req.schema, table: req.table, name, sql: frag.sql };
  }

  async dropIndex(connectionId: string, req: DropIndexRequest): Promise<DropIndexResult> {
    const structure = await this.metadataService.getTableStructure(connectionId, req.schema, req.table);
    const exists = structure.indexes.some((idx) => idx.name === req.index);
    if (!exists) {
      throw new UnprocessableEntityException(`Index "${req.index}" does not exist on "${req.schema}"."${req.table}"`);
    }

    const frag = this.driver.buildDropIndex({ namespace: req.schema, name: req.index }, req.index);

    try {
      await this.pool.run(connectionId, frag);
    } catch (err: unknown) {
      this.driver.mapError(err, { operation: 'dropIndex' });
      throw err;
    }

    return { schema: req.schema, index: req.index, sql: frag.sql };
  }
}
