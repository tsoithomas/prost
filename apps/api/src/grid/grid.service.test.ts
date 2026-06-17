import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata } from '@prost/shared-types';
import { GridService } from './grid.service';
import type { MetadataService } from '../metadata/metadata.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { DriverResult } from '../database/types';
import { PgDriver } from '../database/drivers/pg/pg-driver';

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false },
];

const NO_PK_COLUMNS: ColumnMetadata[] = [
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false },
];

function result<T extends Record<string, unknown>>(rows: T[]): DriverResult {
  return { rows: rows as never, fields: [], rowCount: rows.length, command: 'SELECT' };
}

function createService(run = vi.fn(), columns: ColumnMetadata[] = COLUMNS) {
  const metadataService = {
    getTableColumns: vi.fn().mockResolvedValue(columns),
  } as unknown as MetadataService;

  const pool = { run } as unknown as PoolManager;
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);

  return { service: new GridService(pool, driver, metadataService), run };
}

describe('GridService.getRows', () => {
  it('builds a quoted SELECT with LIMIT/OFFSET bound as $n params', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }]))
      .mockResolvedValueOnce(result([{ reltuples: 5 }]));
    const { service } = createService(run);

    await service.getRows('conn-1', 'public', 'users', { limit: 50, offset: 10 });

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).toBe('SELECT * FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2');
    expect(frag.params).toEqual([50, 10]);
  });

  it('quotes a whitelisted sortBy column and applies sortDir', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(run);

    await service.getRows('conn-1', 'public', 'users', { sortBy: 'email', sortDir: 'desc' });

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('SELECT * FROM "public"."users" ORDER BY "email" DESC LIMIT $1 OFFSET $2');
  });

  it('falls back to the primary key when sortBy is not a real column (no interpolation of unknown input)', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(run);

    await service.getRows('conn-1', 'public', 'users', { sortBy: 'email; DROP TABLE users' });

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('SELECT * FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2');
    expect(frag.sql).not.toContain('DROP TABLE');
  });

  it('estimates totalRows via pg_class.reltuples with schema/table bound as params', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 5 }]));
    const { service } = createService(run);

    const response = await service.getRows('conn-1', 'public', 'users', {});

    const [, frag] = run.mock.calls[1]!;
    expect(frag.sql).toContain('pg_class');
    expect(frag.sql).toContain('to_regclass');
    expect(frag.params).toEqual(['public', 'users']);
    expect(response.totalRows).toBe(5);
  });

  it('returns editable=true with the primary key and sourceTable', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(run);

    const response = await service.getRows('conn-1', 'public', 'users', {});

    expect(response.editable).toBe(true);
    expect(response.primaryKey).toEqual(['id']);
    expect(response.sourceTable).toBe('public.users');
  });

  it('throws NotFoundException when the table has no columns', async () => {
    const { service } = createService(vi.fn(), []);

    await expect(service.getRows('conn-1', 'public', 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GridService.updateCell', () => {
  it('builds a quoted UPDATE ... RETURNING * with value and PK bound as $n params', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 1, email: 'new@x.com' }]));
    const { service } = createService(run);

    const row = await service.updateCell('conn-1', 'public', 'users', {
      primaryKey: { id: 1 },
      column: 'email',
      value: 'new@x.com',
    });

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).toBe('UPDATE "public"."users" SET "email" = $1 WHERE "id" = $2 RETURNING *');
    expect(frag.params).toEqual(['new@x.com', 1]);
    expect(row).toEqual({ id: 1, email: 'new@x.com' });
  });

  it('rejects a column that does not exist on the table', async () => {
    const { service } = createService();

    await expect(
      service.updateCell('conn-1', 'public', 'users', { primaryKey: { id: 1 }, column: 'nope', value: 'x' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a primary key that does not match the live PK set', async () => {
    const { service } = createService();

    await expect(
      service.updateCell('conn-1', 'public', 'users', { primaryKey: { email: 'x' }, column: 'email', value: 'y' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects writes to a table with no primary key', async () => {
    const { service } = createService(vi.fn(), NO_PK_COLUMNS);

    await expect(
      service.updateCell('conn-1', 'public', 'logs', { primaryKey: {}, column: 'email', value: 'y' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws NotFoundException when no row matches the primary key (changed/deleted concurrently)', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([]));
    const { service } = createService(run);

    await expect(
      service.updateCell('conn-1', 'public', 'users', { primaryKey: { id: 1 }, column: 'email', value: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GridService.insertRow', () => {
  it('builds a quoted INSERT ... RETURNING * with values bound as $n params', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 2, email: 'new@x.com' }]));
    const { service } = createService(run);

    const row = await service.insertRow('conn-1', 'public', 'users', { values: { email: 'new@x.com' } });

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('INSERT INTO "public"."users" ("email") VALUES ($1) RETURNING *');
    expect(frag.params).toEqual(['new@x.com']);
    expect(row).toEqual({ id: 2, email: 'new@x.com' });
  });

  it('drops unknown keys from values rather than trusting them', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 2, email: 'new@x.com' }]));
    const { service } = createService(run);

    await service.insertRow('conn-1', 'public', 'users', { values: { email: 'new@x.com', evil: 'DROP TABLE' } });

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('INSERT INTO "public"."users" ("email") VALUES ($1) RETURNING *');
    expect(frag.params).toEqual(['new@x.com']);
  });

  it('emits DEFAULT VALUES when values is empty', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 3, email: null }]));
    const { service } = createService(run);

    await service.insertRow('conn-1', 'public', 'users', { values: {} });

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('INSERT INTO "public"."users" DEFAULT VALUES RETURNING *');
    expect(frag.params).toEqual([]);
  });

  it('rejects inserts into a table with no primary key', async () => {
    const { service } = createService(vi.fn(), NO_PK_COLUMNS);

    await expect(service.insertRow('conn-1', 'public', 'logs', { values: {} })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('GridService.deleteRow', () => {
  it('builds a quoted DELETE with the primary key bound as $n params', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 1 }]));
    const { service } = createService(run);

    await service.deleteRow('conn-1', 'public', 'users', { primaryKey: { id: 1 } });

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).toBe('DELETE FROM "public"."users" WHERE "id" = $1');
    expect(frag.params).toEqual([1]);
  });

  it('rejects a primary key that does not match the live PK set', async () => {
    const { service } = createService();

    await expect(
      service.deleteRow('conn-1', 'public', 'users', { primaryKey: { email: 'x' } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws NotFoundException when no row matches the primary key', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([]));
    const { service } = createService(run);

    await expect(service.deleteRow('conn-1', 'public', 'users', { primaryKey: { id: 1 } })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
