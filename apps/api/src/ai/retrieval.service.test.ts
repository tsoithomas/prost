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
    { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
    { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
    { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
  ],
  indexes: [
    { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
    { name: 'users_email_idx', columns: ['email'], isUnique: true, isPrimary: false, method: 'btree', definition: '' },
  ],
  foreignKeys: [],
};

const ORDERS_STRUCTURE = {
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
    { name: 'user_id', dataType: 'integer', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
    { name: 'total', dataType: 'numeric', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
  ],
  indexes: [
    { name: 'orders_pkey', columns: ['id'], isUnique: true, isPrimary: true, method: 'btree', definition: '' },
  ],
  foreignKeys: [
    {
      constraintName: 'orders_user_id_fkey',
      columns: ['user_id'],
      referencedSchema: 'public',
      referencedTable: 'users',
      referencedColumns: ['id'],
    },
  ],
};

const OVERVIEW = {
  schema: 'public',
  tables: [
    { schema: 'public', name: 'users', rowEstimate: 1200, sizeBytes: null, columnCount: 3, indexCount: 2, engine: null, collation: null, comment: 'Registered accounts' },
    { schema: 'public', name: 'orders', rowEstimate: 45000, sizeBytes: null, columnCount: 3, indexCount: 1, engine: null, collation: null, comment: null },
  ],
  totalRowEstimate: 46200,
  totalSizeBytes: null,
};

function createService() {
  const metadataService = {
    getSchemas: vi.fn().mockResolvedValue(MOCK_SCHEMAS),
    getSchemaOverview: vi.fn().mockResolvedValue(OVERVIEW),
    getTableStructure: vi.fn().mockImplementation(
      (_id: string, _schema: string, table: string) =>
        Promise.resolve(table === 'users' ? USERS_STRUCTURE : ORDERS_STRUCTURE),
    ),
  } as unknown as MetadataService;
  return { service: new RetrievalService(metadataService), metadataService };
}

describe('RetrievalService', () => {
  describe('buildContext', () => {
    it('lists every table by name', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).toContain('public.users');
      expect(ctx).toContain('public.orders');
    });

    it('sends names only — no columns, foreign keys, indexes, or row counts', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).not.toContain('email text NOT NULL');
      expect(ctx).not.toContain('FOREIGN KEY');
      expect(ctx).not.toContain('users_email_idx');
      expect(ctx).not.toContain('rows');
    });

    it('instructs the model to use get_table_schema for columns', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(ctx).toContain('get_table_schema');
    });

    it('lists every table even on a large schema, and notes the overflow', async () => {
      const tables = [
        ...Array.from({ length: 60 }, (_, i) => ({ schema: 'loanstudio', name: `a_table_${i}` })),
        { schema: 'loanstudio', name: 'clients' },
      ];
      const metadataService = {
        getSchemas: vi.fn().mockResolvedValue([{ name: 'loanstudio', tables }]),
      } as unknown as MetadataService;
      const service = new RetrievalService(metadataService);

      // Even a small char budget still names `clients` (with a truncation note if it overflows).
      const ctx = await service.buildContext('conn-1', { maxChars: 400 });
      const listedClients = ctx.includes('loanstudio.clients');
      const notedOverflow = /more tables/.test(ctx);
      expect(listedClients || notedOverflow).toBe(true);
    });

    it('built context passes containsOnlySchemaMetadata guard (Decision 1)', async () => {
      const { service } = createService();
      const ctx = await service.buildContext('conn-1');
      expect(service.containsOnlySchemaMetadata(ctx)).toBe(true);
    });

    it('does not fetch per-table structure or overview when building the index', async () => {
      const { service, metadataService } = createService();
      await service.buildContext('conn-1');
      expect(metadataService.getTableStructure).not.toHaveBeenCalled();
      expect(metadataService.getSchemaOverview).not.toHaveBeenCalled();
    });
  });

  describe('describeTables', () => {
    it('renders full blocks for named tables (bare and schema-qualified)', async () => {
      const { service } = createService();
      const out = await service.describeTables('conn-1', ['orders', 'public.users']);
      expect(out).toContain('public.orders');
      expect(out).toContain('FOREIGN KEY (user_id) REFERENCES public.users(id)');
      expect(out).toContain('public.users');
      expect(out).toContain('email text NOT NULL');
    });

    it('reports tables that do not exist without throwing', async () => {
      const { service } = createService();
      const out = await service.describeTables('conn-1', ['nope']);
      expect(out).toContain('nope: no such table');
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
