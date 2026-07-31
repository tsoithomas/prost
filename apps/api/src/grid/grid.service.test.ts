import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata, MaskedColumns } from '@prost/shared-types';
import { MASK_TOKEN } from '@prost/shared-types';
import { GridService } from './grid.service';
import type { MetadataService } from '../metadata/metadata.service';
import type { AuditService } from '../audit/audit.service';
import type { PreferenceService } from '../preference/preference.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { DriverResult, SqlFragment } from '../database/types';
import { PgDriver } from '../database/drivers/pg/pg-driver';

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

const NO_PK_COLUMNS: ColumnMetadata[] = [
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

function result<T extends Record<string, unknown>>(rows: T[]): DriverResult {
  return { rows: rows as never, fields: [], rowCount: rows.length, command: 'SELECT' };
}

function createService(
  run = vi.fn(),
  columns: ColumnMetadata[] = COLUMNS,
  q?: Mock<(frag: SqlFragment) => Promise<DriverResult>>,
  /** The caller's masking preference (Phase 39); omitted = nothing masked. */
  maskedColumns: MaskedColumns = {},
) {
  const metadataService = {
    getTableColumns: vi.fn().mockResolvedValue(columns),
    getTableForeignKeys: vi.fn().mockResolvedValue([]),
    getReferencingForeignKeys: vi.fn().mockResolvedValue([]),
  } as unknown as MetadataService;

  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);
  // bulkUpdate (guarded builders) passes an explicit `q` mock and asserts on it; updateCell/insertRow
  // use the driver's executing methods, whose query fn routes through `run(connectionId, frag)`.
  const withTransaction = vi.fn(
    (connectionId: string, fn: (query: (frag: SqlFragment) => Promise<DriverResult>) => unknown) => {
      const query = q ?? ((frag: SqlFragment) => run(connectionId, frag));
      return fn(query as (frag: SqlFragment) => Promise<DriverResult>);
    },
  );
  const pool = {
    run,
    withTransaction,
    driverFor: vi.fn().mockResolvedValue(driver),
    assertWritable: vi.fn().mockResolvedValue(undefined),
  } as unknown as PoolManager;

  // Audit mock whose `withAudit` just runs the wrapped operation (recording is a no-op).
  const auditWithAudit = vi.fn((_base: unknown, fn: () => unknown) => fn());
  const audit = { withAudit: auditWithAudit, record: vi.fn() } as unknown as AuditService;

  const preferences = {
    get: vi.fn().mockResolvedValue({ maskedColumns }),
  } as unknown as PreferenceService;

  return {
    service: new GridService(pool, metadataService, audit, preferences),
    run, q, withTransaction, auditWithAudit, preferences,
  };
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
    expect(frag.sql).toBe(
      'SELECT *, xmin::text AS "__version" FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2',
    );
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
    expect(frag.sql).toBe(
      'SELECT *, xmin::text AS "__version" FROM "public"."users" ORDER BY "email" DESC LIMIT $1 OFFSET $2',
    );
  });

  it('falls back to the primary key when sortBy is not a real column (no interpolation of unknown input)', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(run);

    await service.getRows('conn-1', 'public', 'users', { sortBy: 'email; DROP TABLE users' });

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe(
      'SELECT *, xmin::text AS "__version" FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2',
    );
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
    expect(response.concurrency).toBe('token');
  });

  it('omits the version projection and concurrency for a table with no primary key', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ reltuples: 0 }]));
    const { service } = createService(run, NO_PK_COLUMNS);

    const response = await service.getRows('conn-1', 'public', 'logs', {});

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).not.toContain('__version');
    expect(response.editable).toBe(false);
    expect(response.concurrency).toBeUndefined();
  });

  it('throws NotFoundException when the table has no columns', async () => {
    const { service } = createService(vi.fn(), []);

    await expect(service.getRows('conn-1', 'public', 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GridService.updateCell', () => {
  it('builds a quoted UPDATE ... RETURNING * with value and PK bound as $n params', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 1, email: 'new@x.com' }]));
    const { service, withTransaction } = createService(run);

    const row = await service.updateCell('conn-1', 'public', 'users', {
      primaryKey: { id: 1 },
      column: 'email',
      value: 'new@x.com',
    });

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(withTransaction).toHaveBeenCalledWith('conn-1', expect.any(Function));
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
    const { service, withTransaction } = createService(run);

    await expect(
      service.updateCell('conn-1', 'public', 'users', { primaryKey: { id: 1 }, column: 'email', value: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(withTransaction).toHaveBeenCalledWith('conn-1', expect.any(Function));
  });
});

describe('GridService.bulkUpdate', () => {
  it('runs each row update inside one transaction with a version guard and refreshed __version', async () => {
    const q = vi.fn().mockResolvedValue(result([{ id: 1, email: 'a@x.com', __version: '99' }]));
    const { service } = createService(vi.fn(), COLUMNS, q);

    const out = await service.bulkUpdate('conn-1', 'public', 'users', {
      rows: [{ primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'a@x.com' }], version: '42' }],
    });

    const [frag] = q.mock.calls[0]!;
    expect(frag.sql).toBe(
      'UPDATE "public"."users" SET "email" = $1 WHERE "id" = $2 AND xmin = $3::xid RETURNING *, xmin::text AS "__version"',
    );
    expect(frag.params).toEqual(['a@x.com', 1, '42']);
    expect(out.rows).toEqual([{ id: 1, email: 'a@x.com', __version: '99' }]);
  });

  it('builds a preimage guard from `expected` (one IS NOT DISTINCT FROM per column)', async () => {
    const q = vi.fn().mockResolvedValue(result([{ id: 1, email: 'b@x.com' }]));
    const { service } = createService(vi.fn(), COLUMNS, q);

    await service.bulkUpdate('conn-1', 'public', 'users', {
      rows: [{ primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'b@x.com' }], expected: { email: 'a@x.com' } }],
    });

    const [frag] = q.mock.calls[0]!;
    expect(frag.sql).toBe(
      'UPDATE "public"."users" SET "email" = $1 WHERE "id" = $2 AND "email" IS NOT DISTINCT FROM $3 RETURNING *, xmin::text AS "__version"',
    );
    expect(frag.params).toEqual(['b@x.com', 1, 'a@x.com']);
  });

  it('throws ConflictException and commits nothing when a guarded update matches zero rows', async () => {
    // First row updates fine; second is stale (rowCount 0) → whole batch must abort.
    const q = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1, email: 'x' }]))
      .mockResolvedValueOnce({ rows: [], fields: [], rowCount: 0, command: 'UPDATE' });
    const { service } = createService(vi.fn(), COLUMNS, q);

    await expect(
      service.bulkUpdate('conn-1', 'public', 'users', {
        rows: [
          { primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'x' }], version: '1' },
          { primaryKey: { id: 2 }, edits: [{ column: 'email', value: 'y' }], version: '2' },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a row with no concurrency guard (400)', async () => {
    const { service } = createService();

    await expect(
      service.bulkUpdate('conn-1', 'public', 'users', {
        rows: [{ primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'x' }] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an edit to an unknown column (422)', async () => {
    const { service } = createService();

    await expect(
      service.bulkUpdate('conn-1', 'public', 'users', {
        rows: [{ primaryKey: { id: 1 }, edits: [{ column: 'nope', value: 'x' }], version: '1' }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a primary key that does not match the live PK set (422)', async () => {
    const { service } = createService();

    await expect(
      service.bulkUpdate('conn-1', 'public', 'users', {
        rows: [{ primaryKey: { email: 'x' }, edits: [{ column: 'email', value: 'y' }], version: '1' }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects bulk writes to a table with no primary key (422)', async () => {
    const { service } = createService(vi.fn(), NO_PK_COLUMNS);

    await expect(
      service.bulkUpdate('conn-1', 'public', 'logs', {
        rows: [{ primaryKey: {}, edits: [{ column: 'email', value: 'y' }], version: '1' }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('GridService.insertRow', () => {
  it('builds a quoted INSERT ... RETURNING * with values bound as $n params', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ id: 2, email: 'new@x.com' }]));
    const { service, withTransaction } = createService(run);

    const row = await service.insertRow('conn-1', 'public', 'users', { values: { email: 'new@x.com' } });

    const [, frag] = run.mock.calls[0]!;
    expect(withTransaction).toHaveBeenCalledWith('conn-1', expect.any(Function));
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

describe('GridService audit (Phase 28)', () => {
  it('audits an inline cell update with a value-free statement', async () => {
    const run = vi.fn().mockResolvedValue(result([{ id: 1, email: 'x@y.com' }]));
    const { service, auditWithAudit } = createService(run);
    await service.updateCell(
      'conn-1',
      'public',
      'users',
      { column: 'email', value: 'x@y.com', primaryKey: { id: 1 } },
      { userId: 'u1', correlationId: 'corr-2' },
    );
    expect(auditWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', targetSchema: 'public', targetTable: 'users', userId: 'u1', correlationId: 'corr-2' }),
      expect.any(Function),
    );
    const base = auditWithAudit.mock.calls[0]![0] as { sql: string };
    expect(base.sql).toContain('UPDATE public.users');
    expect(base.sql).not.toContain('x@y.com');
  });
});

describe('GridService column masking (Phase 39)', () => {
  const MASKED: MaskedColumns = { 'conn-1': { 'public.users': ['email'] } };

  /** rows, then the row-count estimate — the two reads getRows makes without a filter. */
  function readRun() {
    return vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1, email: 'a@x.com' }, { id: 2, email: null }]))
      .mockResolvedValueOnce(result([{ reltuples: 2 }]));
  }

  it('redacts masked columns server-side and reports which were masked', async () => {
    const { service } = createService(readRun(), COLUMNS, undefined, MASKED);

    const res = await service.getRows('conn-1', 'public', 'users', { userId: 'u1' });

    expect(res.rows[0]).toEqual({ id: 1, email: MASK_TOKEN });
    expect(res.maskedColumns).toEqual(['email']);
    // Unmasked columns are untouched, and NULL stays NULL rather than becoming a token.
    expect(res.rows[1]).toEqual({ id: 2, email: null });
  });

  it('leaves rows alone when the table has nothing masked', async () => {
    const { service } = createService(readRun(), COLUMNS, undefined, MASKED);

    const res = await service.getRows('conn-1', 'public', 'orders', { userId: 'u1' });

    expect(res.rows[0]).toEqual({ id: 1, email: 'a@x.com' });
    expect(res.maskedColumns).toBeUndefined();
  });

  it('does not mask for a different connection', async () => {
    const { service } = createService(readRun(), COLUMNS, undefined, MASKED);

    const res = await service.getRows('conn-2', 'public', 'users', { userId: 'u1' });

    expect(res.rows[0]!.email).toBe('a@x.com');
  });

  it('returns real values on a revealed read, and audits the reveal', async () => {
    const { service, auditWithAudit } = createService(readRun(), COLUMNS, undefined, MASKED);

    const res = await service.getRows('conn-1', 'public', 'users', { userId: 'u1', reveal: true });

    expect(res.rows[0]!.email).toBe('a@x.com');
    expect(res.maskedColumns).toBeUndefined();
    expect(auditWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reveal', targetSchema: 'public', targetTable: 'users', userId: 'u1' }),
      expect.any(Function),
    );
    // The audit row names the columns revealed, never a value.
    const base = auditWithAudit.mock.calls[0]![0] as { sql: string };
    expect(base.sql).toContain('email');
    expect(base.sql).not.toContain('a@x.com');
  });

  it('does not audit a read of a table with nothing masked', async () => {
    const { service, auditWithAudit } = createService(readRun(), COLUMNS, undefined, {});

    await service.getRows('conn-1', 'public', 'users', { userId: 'u1', reveal: true });

    expect(auditWithAudit).not.toHaveBeenCalled();
  });

  it('refuses an inline edit to a masked column', async () => {
    const { service, run } = createService(vi.fn(), COLUMNS, undefined, MASKED);

    await expect(
      service.updateCell(
        'conn-1', 'public', 'users',
        { column: 'email', value: 'new@x.com', primaryKey: { id: 1 } },
        { userId: 'u1' },
      ),
    ).rejects.toThrow(UnprocessableEntityException);
    // Rejected before any statement ran — not a disabled input, a server-side gate.
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a bulk edit touching a masked column', async () => {
    const { service } = createService(vi.fn(), COLUMNS, undefined, MASKED);

    await expect(
      service.bulkUpdate(
        'conn-1', 'public', 'users',
        { rows: [{ primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'x' }], version: '1' }] },
        { userId: 'u1' },
      ),
    ).rejects.toThrow(/masked/);
  });

  it('still allows editing an unmasked column on a table that has masks', async () => {
    const run = vi.fn().mockResolvedValue(result([{ id: 9, email: 'a@x.com' }]));
    const { service } = createService(run, COLUMNS, undefined, MASKED);

    await expect(
      service.updateCell(
        'conn-1', 'public', 'users',
        { column: 'id', value: 9, primaryKey: { id: 1 } },
        { userId: 'u1' },
      ),
    ).resolves.toBeDefined();
  });

  it('skips masking entirely without a user context (internal callers)', async () => {
    const { service, preferences } = createService(readRun(), COLUMNS, undefined, MASKED);

    const res = await service.getRows('conn-1', 'public', 'users', {});

    expect(res.rows[0]!.email).toBe('a@x.com');
    expect(preferences.get).not.toHaveBeenCalled();
  });
});

describe('GridService masking never redacts a primary key (Phase 39)', () => {
  /** rows, then the row-count estimate. */
  function readRun() {
    return vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1, email: 'a@x.com' }, { id: 2, email: 'b@x.com' }]))
      .mockResolvedValueOnce(result([{ reltuples: 2 }]));
  }

  it('returns real PK values even when the PK is marked sensitive', async () => {
    const masked: MaskedColumns = { 'conn-1': { 'public.users': ['id', 'email'] } };
    const { service } = createService(readRun(), COLUMNS, undefined, masked);

    const res = await service.getRows('conn-1', 'public', 'users', { userId: 'u1' });

    // Row identity and the write locator both come from these values.
    expect(res.rows[0]!.id).toBe(1);
    expect(res.rows[1]!.id).toBe(2);
    expect(res.rows[0]!.email).toBe(MASK_TOKEN);
    expect(res.maskedColumns).toEqual(['email']);
  });

  it('reports nothing masked when only the PK was marked', async () => {
    const { service } = createService(readRun(), COLUMNS, undefined, {
      'conn-1': { 'public.users': ['id'] },
    });

    const res = await service.getRows('conn-1', 'public', 'users', { userId: 'u1' });

    expect(res.rows[0]!.id).toBe(1);
    expect(res.maskedColumns).toBeUndefined();
  });

  it('still allows editing a PK that was marked sensitive', async () => {
    const run = vi.fn().mockResolvedValue(result([{ id: 9, email: 'a@x.com' }]));
    const { service } = createService(run, COLUMNS, undefined, { 'conn-1': { 'public.users': ['id'] } });

    // The read shows it in the clear, so refusing the write would be inconsistent.
    await expect(
      service.updateCell('conn-1', 'public', 'users', { column: 'id', value: 9, primaryKey: { id: 1 } }, { userId: 'u1' }),
    ).resolves.toBeDefined();
  });

  it('masks normally on a table with no primary key', async () => {
    const { service } = createService(readRun(), NO_PK_COLUMNS, undefined, {
      'conn-1': { 'public.logs': ['email'] },
    });

    const res = await service.getRows('conn-1', 'public', 'logs', { userId: 'u1' });

    expect(res.rows[0]!.email).toBe(MASK_TOKEN);
    expect(res.editable).toBe(false);
  });
});
