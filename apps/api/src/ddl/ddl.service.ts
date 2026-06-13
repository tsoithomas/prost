import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import type { CreateTableRequest, CreateTableResult, NewColumn } from '@prost/shared-types';
import { PgConnectionService } from '../target-db/pg-connection.service';

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

@Injectable()
export class DdlService {
  constructor(private readonly pgConnectionService: PgConnectionService) {}

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

    const sql = this.buildSql({ schema: req.schema, table: req.table, columns });

    try {
      await this.pgConnectionService.runParameterized(connectionId, sql, []);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '42P07') {
        throw new ConflictException(`Table "${req.schema}"."${req.table}" already exists`);
      }
      throw err;
    }

    return { schema: req.schema, table: req.table, sql };
  }

  /** Returns the canonical (lowercased, whitespace-normalized) type that `buildSql` will emit verbatim. */
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

  /** Returns the canonical (trimmed, lowercased) default that `buildSql` will emit verbatim, or `null` if none. */
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

  buildSql(req: CreateTableRequest): string {
    const pkColumns = req.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    const colDefs = req.columns.map((col) => {
      let def = `  ${quoteIdent(col.name)} ${col.type}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.default !== undefined && col.default !== '') def += ` DEFAULT ${col.default.trim()}`;
      return def;
    });

    if (pkColumns.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkColumns.map(quoteIdent).join(', ')})`);
    }

    return `CREATE TABLE ${quoteIdent(req.schema)}.${quoteIdent(req.table)} (\n${colDefs.join(',\n')}\n)`;
  }
}
