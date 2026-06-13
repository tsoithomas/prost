import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import type { CreateTableRequest, CreateTableResult } from '@prost/shared-types';
import { PgConnectionService } from '../target-db/pg-connection.service';

const ALLOWED_TYPES = new Set([
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'boolean', 'text', 'varchar', 'char',
  'real', 'double precision', 'numeric',
  'date', 'time', 'timestamp', 'timestamptz',
  'uuid', 'json', 'jsonb', 'bytea',
]);

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

    for (const col of req.columns) {
      this.validateType(col.type);
      this.validateDefault(col.default);
    }

    const sql = this.buildSql(req);

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

  private validateType(type: string): void {
    const base = type.replace(/\(\s*\d+\s*(,\s*\d+\s*)?\)$/, '').trim().toLowerCase();
    if (!ALLOWED_TYPES.has(base)) {
      throw new UnprocessableEntityException(
        `Unsupported column type "${type}". Allowed types: ${[...ALLOWED_TYPES].join(', ')}`,
      );
    }
  }

  private validateDefault(value: string | undefined): void {
    if (value === undefined || value === '') return;
    if (!SAFE_DEFAULT_PATTERN.test(value.trim())) {
      throw new UnprocessableEntityException(
        `Unsupported default value "${value}". Allowed: now(), current_timestamp, gen_random_uuid(), true, false, null, or a non-negative integer`,
      );
    }
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
