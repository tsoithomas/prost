import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ColumnMetadata } from '@prost/shared-types';
import type { ParameterizedResult } from '../target-db/pg-connection.service';
import { GridService } from './grid.service';
import type { MetadataService } from '../metadata/metadata.service';
import type { PgConnectionService } from '../target-db/pg-connection.service';

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false },
];

function result<T>(rows: T[]): ParameterizedResult<T extends Record<string, unknown> ? T : never> {
  return { rows: rows as never, fields: [], rowCount: rows.length };
}

function createService(runParameterized = vi.fn(), columns: ColumnMetadata[] = COLUMNS) {
  const metadataService = {
    getTableColumns: vi.fn().mockResolvedValue(columns),
  } as unknown as MetadataService;

  const pgConnectionService = { runParameterized } as unknown as PgConnectionService;

  return { service: new GridService(pgConnectionService, metadataService), runParameterized };
}

describe('GridService.getRows', () => {
  it('builds a quoted SELECT with LIMIT/OFFSET bound as $n params', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }]))
      .mockResolvedValueOnce(result([{ reltuples: 5 }]));
    const { service } = createService(runParameterized);

    await service.getRows('conn-1', 'public', 'users', { limit: 50, offset: 10 });

    const [connectionId, sql, params] = runParameterized.mock.calls[0];
    expect(connectionId).toBe('conn-1');
    expect(sql).toBe('SELECT * FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2');
    expect(params).toEqual([50, 10]);
  });

  it('quotes a whitelisted sortBy column and applies sortDir', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(runParameterized);

    await service.getRows('conn-1', 'public', 'users', { sortBy: 'email', sortDir: 'desc' });

    const [, sql] = runParameterized.mock.calls[0];
    expect(sql).toBe('SELECT * FROM "public"."users" ORDER BY "email" DESC LIMIT $1 OFFSET $2');
  });

  it('falls back to the primary key when sortBy is not a real column (no interpolation of unknown input)', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(runParameterized);

    await service.getRows('conn-1', 'public', 'users', { sortBy: 'email; DROP TABLE users' });

    const [, sql] = runParameterized.mock.calls[0];
    expect(sql).toBe('SELECT * FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('estimates totalRows via pg_class.reltuples with schema/table bound as params', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 5 }]));
    const { service } = createService(runParameterized);

    const response = await service.getRows('conn-1', 'public', 'users', {});

    const [, sql, params] = runParameterized.mock.calls[1];
    expect(sql).toContain('pg_class');
    expect(sql).toContain('to_regclass');
    expect(params).toEqual(['public', 'users']);
    expect(response.totalRows).toBe(5);
  });

  it('returns editable=true with the primary key and sourceTable', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(runParameterized);

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
