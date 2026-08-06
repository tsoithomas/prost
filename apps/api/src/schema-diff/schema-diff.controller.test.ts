import { describe, expect, it, vi } from 'vitest';
import type { ConnectionsService } from '../connections/connections.service';
import { SchemaDiffController } from './schema-diff.controller';
import type { SchemaDiffService } from './schema-diff.service';
import type { GenerateMigrationDto, SchemaCompareDto } from './dto/schema-diff.dto';

describe('SchemaDiffController', () => {
  it('asserts ownership on the :id connection before comparing', async () => {
    const order: string[] = [];
    const connections = {
      assertOwnership: vi.fn(async () => {
        order.push('ownership');
      }),
    } as unknown as ConnectionsService;
    const schemaDiff = {
      compare: vi.fn(async () => {
        order.push('compare');
        return { left: {}, right: {}, tables: [] };
      }),
    } as unknown as SchemaDiffService;
    const controller = new SchemaDiffController(connections, schemaDiff);
    const dto: SchemaCompareDto = { schema: 'public', right: { connectionId: 'c2', schema: 'public' } };

    await controller.compare({ userId: 'u1' } as never, 'c1', dto);

    expect(connections.assertOwnership).toHaveBeenCalledWith('u1', 'c1');
    expect(schemaDiff.compare).toHaveBeenCalledWith('u1', { connectionId: 'c1', schema: 'public' }, dto.right);
    expect(order).toEqual(['ownership', 'compare']);
  });

  it('asserts ownership on the :id connection before generating a migration', async () => {
    const connections = { assertOwnership: vi.fn(async () => {}) } as unknown as ConnectionsService;
    const schemaDiff = { generateMigration: vi.fn(async () => ({ changes: [] })) } as unknown as SchemaDiffService;
    const controller = new SchemaDiffController(connections, schemaDiff);
    const dto: GenerateMigrationDto = { schema: 'public', right: { connectionId: 'c2', schema: 'public' }, source: 'left' };

    await controller.migration({ userId: 'u1' } as never, 'c1', dto);

    expect(connections.assertOwnership).toHaveBeenCalledWith('u1', 'c1');
    expect(schemaDiff.generateMigration).toHaveBeenCalledWith('u1', { connectionId: 'c1', schema: 'public' }, dto.right, 'left');
  });
});
