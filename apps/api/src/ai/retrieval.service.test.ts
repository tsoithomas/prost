import { describe, expect, it, vi } from 'vitest';
import type { MetadataService } from '../metadata/metadata.service';
import { RetrievalService } from './retrieval.service';

const MOCK_SCHEMAS = [
  {
    name: 'public',
    tables: [
      { schema: 'public', name: 'users' },
      { schema: 'public', name: 'orders' },
    ],
  },
];

const USERS_STRUCTURE = {
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
    { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false },
    { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false },
  ],
  indexes: [
    { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
    { name: 'users_email_idx', columns: ['email'], isUnique: true, isPrimary: false, method: 'btree', definition: '' },
  ],
};

const ORDERS_STRUCTURE = {
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
    { name: 'user_id', dataType: 'integer', nullable: false, isPrimaryKey: false },
    { name: 'total', dataType: 'numeric', nullable: true, isPrimaryKey: false },
  ],
  indexes: [
    { name: 'orders_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
  ],
};

function createService() {
  const metadataService = {
    getSchemas: vi.fn().mockResolvedValue(MOCK_SCHEMAS),
    getTableStructure: vi.fn().mockImplementation(
      (_id: string, _schema: string, table: string) =>
        Promise.resolve(table === 'users' ? USERS_STRUCTURE : ORDERS_STRUCTURE),
    ),
  } as unknown as MetadataService;
  return { service: new RetrievalService(metadataService), metadataService };
}

describe('RetrievalService', () => {
  describe('buildContext', () => {
    it('includes schema.table header for every table', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).toContain('public.users');
      expect(ctx).toContain('public.orders');
    });

    it('includes column names and types', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).toContain('email text NOT NULL');
      expect(ctx).toContain('user_id integer NOT NULL');
      expect(ctx).toContain('name text');
    });

    it('marks primary key columns', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).toMatch(/id integer PRIMARY KEY/);
    });

    it('omits primary indexes from context', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).not.toContain('users_pkey');
      expect(ctx).not.toContain('orders_pkey');
    });

    it('includes non-primary unique indexes', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).toContain('users_email_idx');
      expect(ctx).toContain('UNIQUE');
    });

    it('respects token budget and stops before overflow', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1', 50);
      // With 50-char budget the first block alone (>50 chars) can't be added,
      // so context should be empty or contain at most the first table.
      expect(ctx.length).toBeLessThanOrEqual(300);
    });

    it('built context passes containsOnlySchemaMetadata guard (Decision 1)', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(service.containsOnlySchemaMetadata(ctx)).toBe(true);
    });
  });

  describe('containsOnlySchemaMetadata', () => {
    it('returns true for clean schema text', () => {
      const { service } = createService();
      expect(service.containsOnlySchemaMetadata('SELECT id, email FROM users')).toBe(true);
    });

    it('returns false when context contains "password"', () => {
      const { service } = createService();
      expect(service.containsOnlySchemaMetadata('password: hunter2')).toBe(false);
    });

    it('returns false when context contains "secret"', () => {
      const { service } = createService();
      expect(service.containsOnlySchemaMetadata('my_secret=abc123')).toBe(false);
    });

    it('returns false when context contains "api_key"', () => {
      const { service } = createService();
      expect(service.containsOnlySchemaMetadata('api_key=xyz')).toBe(false);
    });

    it('is case-insensitive', () => {
      const { service } = createService();
      expect(service.containsOnlySchemaMetadata('PASSWORD=foo')).toBe(false);
    });
  });
});
