import { describe, expect, it, vi } from 'vitest';
import { ConnectionsService } from '../connections/connections.service';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

describe('PerformanceController', () => {
  it('enforces ownership before loading a connection snapshot', async () => {
    const order: string[] = [];
    const connections = {
      assertOwnership: vi.fn(async () => {
        order.push('ownership');
      }),
    } as unknown as ConnectionsService;
    const performance = {
      getSnapshot: vi.fn(async () => {
        order.push('snapshot');
        return { status: 'available' as const, statements: [] };
      }),
    } as unknown as PerformanceService;
    const controller = new PerformanceController(connections, performance);

    await expect(controller.statements({ userId: 'u1' } as never, 'c1')).resolves.toEqual({
      status: 'available',
      statements: [],
    });
    expect(connections.assertOwnership).toHaveBeenCalledWith('u1', 'c1');
    expect(order).toEqual(['ownership', 'snapshot']);
  });
});
