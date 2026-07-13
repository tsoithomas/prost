import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnMetadata, IndexMetadata, TableStructure } from '@prost/shared-types';
import { PgDriver } from '../database/drivers/pg/pg-driver';
import type { PoolManager } from '../database/pool-manager.service';
import type { MetadataService } from '../metadata/metadata.service';
import { DdlService } from './ddl.service';

const DEFAULT_COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
  { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
  { name: 'note', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

const DEFAULT_INDEXES: IndexMetadata[] = [
  { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
  { name: 'users_email_idx', columns: ['email'], isUnique: true, isPrimary: false, method: 'btree', definition: '' },
];

function mockStructure(columns = DEFAULT_COLUMNS, indexes = DEFAULT_INDEXES): TableStructure {
  return { columns, indexes, foreignKeys: [] };
}

function createService(
  run = vi.fn().mockResolvedValue({ rows: [], rowCount: 0, fields: [], command: 'CREATE' }),
  structure: TableStructure = mockStructure(),
) {
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);
  const pool = { run, driverFor: vi.fn().mockResolvedValue(driver) } as unknown as PoolManager;
  const metadataService = {
    getTableStructure: vi.fn().mockResolvedValue(structure),
    getTableColumns: vi.fn().mockResolvedValue(structure.columns),
  } as unknown as MetadataService;
  return { service: new DdlService(pool, metadataService), driver, runParameterized: run, metadataService };
}

describe('DdlService buildCreateTable — identifier quoting', () => {
  it('double-quotes schema, table, and all column names', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 'widgets',
      columns: [{ name: 'id', type: 'serial', nullable: false, isPrimaryKey: true }],
    });
    expect(sql).toContain('"public"');
    expect(sql).toContain('"widgets"');
    expect(sql).toContain('"id"');
    expect(sql).not.toMatch(/\bpublic\b(?!")/);
    expect(sql).not.toMatch(/\bwidgets\b(?!")/);
  });

  it('escapes double-quote chars inside identifiers', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 'my"table',
      columns: [{ name: 'col', type: 'text', nullable: true, isPrimaryKey: false }],
    });
    expect(sql).toContain('"my""table"');
  });
});

describe('DdlService buildCreateTable — column definitions', () => {
  it('emits NOT NULL when nullable is false', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [{ name: 'name', type: 'text', nullable: false, isPrimaryKey: false }],
    });
    expect(sql).toContain('NOT NULL');
  });

  it('omits NOT NULL when nullable is true', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [{ name: 'note', type: 'text', nullable: true, isPrimaryKey: false }],
    });
    expect(sql).not.toContain('NOT NULL');
  });

  it('emits DEFAULT clause when default is provided', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [{ name: 'created_at', type: 'timestamptz', nullable: false, isPrimaryKey: false, default: 'now()' }],
    });
    expect(sql).toContain('DEFAULT now()');
  });

  it('omits DEFAULT clause when default is absent', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: false }],
    });
    expect(sql).not.toContain('DEFAULT');
  });
});

describe('DdlService buildCreateTable — PRIMARY KEY clause', () => {
  it('emits no PRIMARY KEY clause when no column is flagged', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: false }],
    });
    expect(sql).not.toContain('PRIMARY KEY');
  });

  it('emits a single-column PRIMARY KEY clause', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [{ name: 'id', type: 'serial', nullable: false, isPrimaryKey: true }],
    });
    expect(sql).toContain('PRIMARY KEY ("id")');
  });

  it('emits a multi-column PRIMARY KEY clause', () => {
    const { driver } = createService();
    const { sql } = driver.buildCreateTable({
      schema: 'public',
      table: 't',
      columns: [
        { name: 'a', type: 'integer', nullable: false, isPrimaryKey: true },
        { name: 'b', type: 'text', nullable: false, isPrimaryKey: true },
      ],
    });
    expect(sql).toContain('PRIMARY KEY ("a", "b")');
  });
});

describe('DdlService.createTable — validation', () => {
  it('throws 422 for empty columns array', async () => {
    const { service } = createService();
    await expect(service.createTable('conn-1', { schema: 'public', table: 't', columns: [] }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 for duplicate column names', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [
          { name: 'id', type: 'integer', nullable: false, isPrimaryKey: false },
          { name: 'id', type: 'text', nullable: true, isPrimaryKey: false },
        ],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 for an unknown type', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'col', type: 'malicious; DROP TABLE', nullable: true, isPrimaryKey: false }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('accepts known types with length params — varchar(255)', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'col', type: 'varchar(255)', nullable: true, isPrimaryKey: false }],
      }),
    ).resolves.toBeDefined();
  });

  it('accepts numeric(10,2) as a valid type', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'price', type: 'numeric(10,2)', nullable: false, isPrimaryKey: false }],
      }),
    ).resolves.toBeDefined();
  });

  it('throws 422 for a disallowed default expression', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'col', type: 'text', nullable: true, isPrimaryKey: false, default: "'; DROP TABLE users; --" }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('accepts now() as a default', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'ts', type: 'timestamptz', nullable: false, isPrimaryKey: false, default: 'now()' }],
      }),
    ).resolves.toBeDefined();
  });

  it('accepts gen_random_uuid() as a default', async () => {
    const { service } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'gen_random_uuid()' }],
      }),
    ).resolves.toBeDefined();
  });

  it('maps Postgres 42P07 to ConflictException', async () => {
    const err = Object.assign(new Error('duplicate'), { code: '42P07' });
    const run = vi.fn().mockRejectedValue(err);
    const { service } = createService(run);
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 'widgets',
        columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DdlService.createTable — type/default normalization', () => {
  it('rejects a type with an embedded statement terminator, before reaching the database', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'col', type: 'integer); DROP TABLE users; --', nullable: true, isPrimaryKey: false }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('rejects a length parameter on a type that does not support one (e.g. integer(10))', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.createTable('conn-1', {
        schema: 'public',
        table: 't',
        columns: [{ name: 'col', type: 'integer(10)', nullable: true, isPrimaryKey: false }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('normalizes type casing/whitespace and default casing into canonical SQL', async () => {
    const { service } = createService();
    const result = await service.createTable('conn-1', {
      schema: 'public',
      table: 't',
      columns: [
        { name: 'col', type: '  VARCHAR( 255 ) ', nullable: true, isPrimaryKey: false },
        { name: 'ts', type: 'TimestampTz', nullable: false, isPrimaryKey: false, default: '  NOW()  ' },
      ],
    });
    expect(result.sql).toContain('"col" varchar(255)');
    expect(result.sql).toContain('"ts" timestamptz NOT NULL DEFAULT now()');
  });
});

describe('DdlService.alterTable — addColumn', () => {
  it('emits ALTER TABLE … ADD COLUMN with quoted identifiers', async () => {
    const { service, runParameterized } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'addColumn', column: { name: 'score', type: 'integer', nullable: true, isPrimaryKey: false } },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ADD COLUMN "score" integer');
    expect(runParameterized).toHaveBeenCalledWith('conn-1', { sql: result.sql, params: [] });
  });

  it('emits NOT NULL and DEFAULT when set', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'addColumn', column: { name: 'score', type: 'integer', nullable: false, isPrimaryKey: false, default: '0' } },
    });
    expect(result.sql).toContain('NOT NULL');
    expect(result.sql).toContain('DEFAULT 0');
  });

  it('throws 409 when the column already exists', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', {
        schema: 'public',
        table: 'users',
        operation: { kind: 'addColumn', column: { name: 'email', type: 'text', nullable: true, isPrimaryKey: false } },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('throws 422 for an unknown type', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', {
        schema: 'public',
        table: 'users',
        operation: { kind: 'addColumn', column: { name: 'x', type: 'evil; DROP TABLE', nullable: true, isPrimaryKey: false } },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });
});

describe('DdlService.alterTable — dropColumn', () => {
  it('emits ALTER TABLE … DROP COLUMN with quoted identifier', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'dropColumn', column: 'note' },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" DROP COLUMN "note"');
  });

  it('throws 422 when the column does not exist', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', { schema: 'public', table: 'users', operation: { kind: 'dropColumn', column: 'nope' } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('throws 422 when attempting to drop a primary key column', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', { schema: 'public', table: 'users', operation: { kind: 'dropColumn', column: 'id' } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });
});

describe('DdlService.alterTable — setNotNull / setDefault / changeType', () => {
  it('emits SET NOT NULL', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'setNotNull', column: 'note', notNull: true },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ALTER COLUMN "note" SET NOT NULL');
  });

  it('emits DROP NOT NULL', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'setNotNull', column: 'note', notNull: false },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ALTER COLUMN "note" DROP NOT NULL');
  });

  it('emits SET DEFAULT', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'setDefault', column: 'note', default: 'now()' },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ALTER COLUMN "note" SET DEFAULT now()');
  });

  it('emits DROP DEFAULT when default is null', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'setDefault', column: 'note', default: null },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ALTER COLUMN "note" DROP DEFAULT');
  });

  it('throws 422 for a disallowed default value', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', {
        schema: 'public',
        table: 'users',
        operation: { kind: 'setDefault', column: 'note', default: "'; DROP TABLE users; --" },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('emits TYPE change', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'changeType', column: 'note', type: 'varchar(255)' },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ALTER COLUMN "note" TYPE varchar(255)');
  });

  it('emits TYPE … USING when using is provided', async () => {
    const { service } = createService();
    const result = await service.alterTable('conn-1', {
      schema: 'public',
      table: 'users',
      operation: { kind: 'changeType', column: 'note', type: 'integer', using: 'note::integer' },
    });
    expect(result.sql).toBe('ALTER TABLE "public"."users" ALTER COLUMN "note" TYPE integer USING note::integer');
  });

  it('throws 422 for a USING expression with disallowed characters', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', {
        schema: 'public',
        table: 'users',
        operation: { kind: 'changeType', column: 'note', type: 'integer', using: "note; DROP TABLE users; --" },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('throws 422 when the target column does not exist', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.alterTable('conn-1', { schema: 'public', table: 'users', operation: { kind: 'setNotNull', column: 'nope', notNull: true } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('maps Postgres 42846 (cannot cast) to 422', async () => {
    const err = Object.assign(new Error('cannot cast'), { code: '42846' });
    const { service } = createService(vi.fn().mockRejectedValue(err));
    await expect(
      service.alterTable('conn-1', { schema: 'public', table: 'users', operation: { kind: 'changeType', column: 'note', type: 'integer' } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('maps Postgres 23502 (not-null violation) to 422', async () => {
    const err = Object.assign(new Error('not null'), { code: '23502' });
    const { service } = createService(vi.fn().mockRejectedValue(err));
    await expect(
      service.alterTable('conn-1', { schema: 'public', table: 'users', operation: { kind: 'setNotNull', column: 'note', notNull: true } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('DdlService.createIndex', () => {
  it('emits CREATE UNIQUE INDEX with quoted identifiers and USING btree', async () => {
    const { service } = createService();
    const result = await service.createIndex('conn-1', {
      schema: 'public',
      table: 'users',
      name: 'users_email_unique',
      columns: ['email'],
      unique: true,
    });
    expect(result.sql).toBe('CREATE UNIQUE INDEX "users_email_unique" ON "public"."users" USING btree ("email")');
    expect(result.name).toBe('users_email_unique');
  });

  it('auto-generates an index name when name is absent', async () => {
    const { service } = createService();
    const result = await service.createIndex('conn-1', {
      schema: 'public',
      table: 'users',
      columns: ['email'],
      unique: false,
    });
    expect(result.name).toBe('users_email_idx');
    expect(result.sql).toContain('"users_email_idx"');
  });

  it('throws 422 when a column does not exist', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.createIndex('conn-1', { schema: 'public', table: 'users', columns: ['nope'], unique: false }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('throws 422 for a disallowed index method', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.createIndex('conn-1', { schema: 'public', table: 'users', columns: ['email'], unique: false, method: 'evil' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('maps Postgres 42P07 (duplicate index) to 409', async () => {
    const err = Object.assign(new Error('dup'), { code: '42P07' });
    const { service } = createService(vi.fn().mockRejectedValue(err));
    await expect(
      service.createIndex('conn-1', { schema: 'public', table: 'users', name: 'dup', columns: ['email'], unique: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DdlService.dropIndex', () => {
  it('emits DROP INDEX with quoted schema and index name', async () => {
    const { service } = createService();
    const result = await service.dropIndex('conn-1', { schema: 'public', table: 'users', index: 'users_email_idx' });
    expect(result.sql).toBe('DROP INDEX "public"."users_email_idx"');
    expect(result.index).toBe('users_email_idx');
  });

  it('throws 422 when the index does not exist on the table, before reaching the database', async () => {
    const { service, runParameterized } = createService();
    await expect(
      service.dropIndex('conn-1', { schema: 'public', table: 'users', index: 'nonexistent_idx' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('maps Postgres 42704 (undefined index) to 422', async () => {
    const err = Object.assign(new Error('no index'), { code: '42704' });
    const { service } = createService(vi.fn().mockRejectedValue(err));
    await expect(
      service.dropIndex('conn-1', { schema: 'public', table: 'users', index: 'users_email_idx' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('DdlService.dropTable', () => {
  it('emits DROP TABLE with quoted schema and table', async () => {
    const { service, runParameterized } = createService();
    const result = await service.dropTable('conn-1', { schema: 'public', table: 'users' });
    expect(result.sql).toBe('DROP TABLE "public"."users"');
    expect(runParameterized).toHaveBeenCalledWith('conn-1', { sql: result.sql, params: [] });
  });

  it('throws 404 when the table does not exist, before reaching the database', async () => {
    const { service, runParameterized } = createService();
    (service as unknown as { metadataService: MetadataService }).metadataService.getTableColumns = vi
      .fn()
      .mockResolvedValue([]);
    await expect(service.dropTable('conn-1', { schema: 'public', table: 'ghost' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(runParameterized).not.toHaveBeenCalled();
  });
});

describe('DdlService.truncateTable', () => {
  it('emits TRUNCATE TABLE with quoted schema and table', async () => {
    const { service, runParameterized } = createService();
    const result = await service.truncateTable('conn-1', { schema: 'public', table: 'users' });
    expect(result.sql).toBe('TRUNCATE TABLE "public"."users"');
    expect(runParameterized).toHaveBeenCalledWith('conn-1', { sql: result.sql, params: [] });
  });

  it('throws 404 when the table does not exist, before reaching the database', async () => {
    const { service, runParameterized } = createService();
    (service as unknown as { metadataService: MetadataService }).metadataService.getTableColumns = vi
      .fn()
      .mockResolvedValue([]);
    await expect(service.truncateTable('conn-1', { schema: 'public', table: 'ghost' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(runParameterized).not.toHaveBeenCalled();
  });
});

describe('DdlService.preview', () => {
  it('previews createTable without executing SQL', async () => {
    const { service, runParameterized } = createService();

    const result = await service.preview('conn-1', {
      kind: 'createTable',
      request: {
        schema: 'public',
        table: 'widgets',
        columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true }],
      },
    });

    expect(result.sql).toContain('CREATE TABLE "public"."widgets"');
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('previews alterTable addColumn without executing SQL', async () => {
    const { service, runParameterized } = createService();

    const result = await service.preview('conn-1', {
      kind: 'alterTable',
      request: {
        schema: 'public',
        table: 'users',
        operation: {
          kind: 'addColumn',
          column: { name: 'score', type: 'integer', nullable: true, isPrimaryKey: false },
        },
      },
    });

    expect(result.sql).toBe('ALTER TABLE "public"."users" ADD COLUMN "score" integer');
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('previews createIndex without executing SQL', async () => {
    const { service, runParameterized } = createService();

    const result = await service.preview('conn-1', {
      kind: 'createIndex',
      request: { schema: 'public', table: 'users', columns: ['email'], unique: false },
    });

    expect(result.sql).toBe('CREATE INDEX "users_email_idx" ON "public"."users" USING btree ("email")');
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('previews dropIndex without executing SQL', async () => {
    const { service, runParameterized } = createService();

    const result = await service.preview('conn-1', {
      kind: 'dropIndex',
      request: { schema: 'public', table: 'users', index: 'users_email_idx' },
    });

    expect(result.sql).toBe('DROP INDEX "public"."users_email_idx"');
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('rejects an unsupported createTable type without executing SQL', async () => {
    const { service, runParameterized } = createService();

    await expect(
      service.preview('conn-1', {
        kind: 'createTable',
        request: {
          schema: 'public',
          table: 'widgets',
          columns: [{ name: 'payload', type: 'evil; DROP TABLE', nullable: true, isPrimaryKey: false }],
        },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(runParameterized).not.toHaveBeenCalled();
  });

  it('rejects addColumn when the column already exists without executing SQL', async () => {
    const { service, runParameterized } = createService();

    await expect(
      service.preview('conn-1', {
        kind: 'alterTable',
        request: {
          schema: 'public',
          table: 'users',
          operation: {
            kind: 'addColumn',
            column: { name: 'email', type: 'text', nullable: true, isPrimaryKey: false },
          },
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(runParameterized).not.toHaveBeenCalled();
  });
});
