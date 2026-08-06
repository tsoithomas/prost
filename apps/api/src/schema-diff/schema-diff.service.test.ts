import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnMetadata, SchemaMetadata } from '@prost/shared-types';
import type { ConnectionsService } from '../connections/connections.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { DdlService } from '../ddl/ddl.service';
import type { MetadataService } from '../metadata/metadata.service';
import { SchemaDiffService } from './schema-diff.service';

function col(overrides: Partial<ColumnMetadata> & { name: string }): ColumnMetadata {
  return { dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null, ...overrides };
}

function schemaMetadata(name: string, tables: SchemaMetadata['tables']): SchemaMetadata {
  return { name, tables, objects: [] };
}

function createService({
  leftEngine = 'postgres',
  rightEngine = 'postgres',
  leftSchema = schemaMetadata('public', [{ schema: 'public', name: 'users', columns: [col({ name: 'id' })] }]),
  rightSchema = schemaMetadata('public', [{ schema: 'public', name: 'users', columns: [col({ name: 'id' })] }]),
  previewThrowsFor,
}: {
  leftEngine?: string;
  rightEngine?: string;
  leftSchema?: SchemaMetadata;
  rightSchema?: SchemaMetadata;
  /** `preview` rejects any change whose table name matches this — stands in for a stale candidate. */
  previewThrowsFor?: string;
} = {}) {
  const connections = { assertOwnership: vi.fn(async () => {}) } as unknown as ConnectionsService;
  const pool = {
    driverFor: vi.fn(async (connectionId: string) => ({
      descriptor: { engine: connectionId === 'left-conn' ? leftEngine : rightEngine },
    })),
  } as unknown as PoolManager;
  const metadata = {
    getSchemas: vi.fn(async (connectionId: string) => [connectionId === 'left-conn' ? leftSchema : rightSchema]),
    getSchemaForeignKeys: vi.fn(async () => []),
    getTableIndexes: vi.fn(async () => []),
  } as unknown as MetadataService;
  const ddl = {
    preview: vi.fn(async (connectionId: string, req: { kind: string; request?: { table?: string } }) => {
      if (previewThrowsFor && req.request?.table === previewThrowsFor) {
        throw new Error(`unknown table ${previewThrowsFor}`);
      }
      return { sql: `-- ${req.kind} on ${connectionId}` };
    }),
  } as unknown as DdlService;

  return { service: new SchemaDiffService(connections, pool, metadata, ddl), connections, pool, metadata, ddl };
}

const LEFT_REF = { connectionId: 'left-conn', schema: 'public' };
const RIGHT_REF = { connectionId: 'right-conn', schema: 'public' };

describe('SchemaDiffService.compare', () => {
  it('asserts ownership on both connections', async () => {
    const { service, connections } = createService();
    await service.compare('u1', LEFT_REF, RIGHT_REF);
    expect(connections.assertOwnership).toHaveBeenCalledWith('u1', 'left-conn');
    expect(connections.assertOwnership).toHaveBeenCalledWith('u1', 'right-conn');
  });

  it('rejects a cross-engine compare before reading either schema', async () => {
    const { service, metadata } = createService({ leftEngine: 'postgres', rightEngine: 'mysql' });
    await expect(service.compare('u1', LEFT_REF, RIGHT_REF)).rejects.toThrow(BadRequestException);
    expect(metadata.getSchemas).not.toHaveBeenCalled();
  });

  it('returns a diff built from both sides live metadata, never persisting anything', async () => {
    const { service } = createService({
      rightSchema: schemaMetadata('public', [
        { schema: 'public', name: 'users', columns: [col({ name: 'id' })] },
        { schema: 'public', name: 'orders', columns: [col({ name: 'id' })] },
      ]),
    });

    const diff = await service.compare('u1', LEFT_REF, RIGHT_REF);
    expect(diff.left).toEqual(LEFT_REF);
    expect(diff.right).toEqual(RIGHT_REF);
    expect(diff.tables.map((t) => t.name).sort()).toEqual(['orders', 'users']);
    expect(diff.tables.find((t) => t.name === 'orders')?.status).toBe('added');
  });
});

describe('SchemaDiffService.generateMigration', () => {
  it('previews each candidate against the target connection and returns survivors with sql + destructive', async () => {
    const { service, ddl } = createService({
      rightSchema: schemaMetadata('public', [{ schema: 'public', name: 'users', columns: [col({ name: 'id' })] }, {
        schema: 'public',
        name: 'orders',
        columns: [col({ name: 'id' })],
      }]),
    });

    const result = await service.generateMigration('u1', LEFT_REF, RIGHT_REF, 'right');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ change: { kind: 'createTable' }, sql: '-- createTable on left-conn', destructive: false });
    // source='right' means left is the target being reconciled.
    expect(ddl.preview).toHaveBeenCalledWith('left-conn', expect.objectContaining({ kind: 'createTable' }));
  });

  it('targets the other connection when source is left', async () => {
    const { service, ddl } = createService({
      rightSchema: schemaMetadata('public', [{ schema: 'public', name: 'users', columns: [col({ name: 'id' })] }, {
        schema: 'public',
        name: 'legacy',
        columns: [col({ name: 'id' })],
      }]),
    });

    await service.generateMigration('u1', LEFT_REF, RIGHT_REF, 'left');
    expect(ddl.preview).toHaveBeenCalledWith('right-conn', expect.objectContaining({ kind: 'dropTable' }));
  });

  it('drops a candidate that fails re-validation instead of throwing', async () => {
    const { service } = createService({
      rightSchema: schemaMetadata('public', [{ schema: 'public', name: 'users', columns: [col({ name: 'id' })] }, {
        schema: 'public',
        name: 'stale',
        columns: [col({ name: 'id' })],
      }]),
      previewThrowsFor: 'stale',
    });

    const result = await service.generateMigration('u1', LEFT_REF, RIGHT_REF, 'right');
    expect(result.changes).toHaveLength(0);
  });
});
