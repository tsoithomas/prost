import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PgConnectionService } from '../target-db/pg-connection.service';
import { DdlService } from './ddl.service';

function createService(runParameterized = vi.fn().mockResolvedValue({ rows: [], rowCount: 0, fields: [], command: 'CREATE' })) {
  const pgConnectionService = { runParameterized } as unknown as PgConnectionService;
  return { service: new DdlService(pgConnectionService), runParameterized };
}

describe('DdlService.buildSql — identifier quoting', () => {
  it('double-quotes schema, table, and all column names', () => {
    const { service } = createService();
    const sql = service.buildSql({
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
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 'my"table',
      columns: [{ name: 'col', type: 'text', nullable: true, isPrimaryKey: false }],
    });
    expect(sql).toContain('"my""table"');
  });
});

describe('DdlService.buildSql — column definitions', () => {
  it('emits NOT NULL when nullable is false', () => {
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 't',
      columns: [{ name: 'name', type: 'text', nullable: false, isPrimaryKey: false }],
    });
    expect(sql).toContain('NOT NULL');
  });

  it('omits NOT NULL when nullable is true', () => {
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 't',
      columns: [{ name: 'note', type: 'text', nullable: true, isPrimaryKey: false }],
    });
    expect(sql).not.toContain('NOT NULL');
  });

  it('emits DEFAULT clause when default is provided', () => {
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 't',
      columns: [{ name: 'created_at', type: 'timestamptz', nullable: false, isPrimaryKey: false, default: 'now()' }],
    });
    expect(sql).toContain('DEFAULT now()');
  });

  it('omits DEFAULT clause when default is absent', () => {
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 't',
      columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: false }],
    });
    expect(sql).not.toContain('DEFAULT');
  });
});

describe('DdlService.buildSql — PRIMARY KEY clause', () => {
  it('emits no PRIMARY KEY clause when no column is flagged', () => {
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 't',
      columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: false }],
    });
    expect(sql).not.toContain('PRIMARY KEY');
  });

  it('emits a single-column PRIMARY KEY clause', () => {
    const { service } = createService();
    const sql = service.buildSql({
      schema: 'public',
      table: 't',
      columns: [{ name: 'id', type: 'serial', nullable: false, isPrimaryKey: true }],
    });
    expect(sql).toContain('PRIMARY KEY ("id")');
  });

  it('emits a multi-column PRIMARY KEY clause', () => {
    const { service } = createService();
    const sql = service.buildSql({
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
