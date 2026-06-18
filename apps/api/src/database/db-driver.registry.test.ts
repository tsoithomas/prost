import type { DbEngineDescriptor } from '@prost/shared-types';
import { describe, expect, it } from 'vitest';
import type { DbDriver } from './db-driver.interface';
import { DbDriverRegistry } from './db-driver.registry';

function driver(descriptor: DbEngineDescriptor): DbDriver {
  return {
    engine: descriptor.engine,
    descriptor,
  } as DbDriver;
}

describe('DbDriverRegistry', () => {
  it('lists every registered descriptor sorted by engine', () => {
    const sqlite = {
      engine: 'sqlite',
      label: 'SQLite',
    } as DbEngineDescriptor;
    const postgres = {
      engine: 'postgres',
      label: 'PostgreSQL',
    } as DbEngineDescriptor;
    const registry = new DbDriverRegistry([driver(sqlite), driver(postgres)]);

    expect(registry.listDescriptors()).toEqual([postgres, sqlite]);
  });

  it('rejects duplicate engine registrations', () => {
    const descriptor = {
      engine: 'postgres',
      label: 'PostgreSQL',
    } as DbEngineDescriptor;

    expect(() => new DbDriverRegistry([driver(descriptor), driver(descriptor)])).toThrow(
      'Duplicate database engine "postgres"',
    );
  });
});
