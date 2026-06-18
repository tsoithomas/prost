import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { RequestMethod } from '@nestjs/common';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseEnginesController } from './database-engines.controller';
import { DbDriverRegistry } from './db-driver.registry';
import { PgDriver } from './drivers/pg/pg-driver';
import { SqliteDriver } from './drivers/sqlite/sqlite-driver';

const ENV_SENTINEL = 'must-not-leak-env-8db6c7';
const CREDENTIAL_SENTINEL = 'must-not-leak-password-4e21d9';

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

afterEach(() => {
  delete process.env.DATABASE_ENGINES_TEST_SECRET;
});

describe('DatabaseEnginesController', () => {
  it('exposes GET /database-engines and returns static registered descriptors only', () => {
    process.env.DATABASE_ENGINES_TEST_SECRET = ENV_SENTINEL;
    const config = {
      get: (key: string) =>
        ({
          QUERY_TIMEOUT_MS: ENV_SENTINEL,
          TARGET_POOL_SIZE: CREDENTIAL_SENTINEL,
          DATABASE_URL: CREDENTIAL_SENTINEL,
        })[key],
    } as ConfigService;
    const registry = new DbDriverRegistry([new SqliteDriver(config), new PgDriver(config)]);
    const controller = new DatabaseEnginesController(registry);

    const descriptors = controller.list();

    expect(Reflect.getMetadata(PATH_METADATA, DatabaseEnginesController)).toBe('database-engines');
    expect(Reflect.getMetadata(PATH_METADATA, controller.list)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.list)).toBe(RequestMethod.GET);
    expect(descriptors.map((descriptor) => descriptor.engine)).toEqual(['postgres', 'sqlite']);

    const keys = collectKeys(descriptors).map((key) => key.toLowerCase());
    expect(keys).not.toContain('host');
    expect(keys).not.toContain('username');
    expect(keys).not.toContain('password');
    expect(keys).not.toContain('database');

    const response = JSON.stringify(descriptors);
    expect(response).not.toContain(ENV_SENTINEL);
    expect(response).not.toContain(CREDENTIAL_SENTINEL);
    expect(descriptors).toEqual(expect.arrayContaining<DbEngineDescriptor>([
      expect.objectContaining({ engine: 'postgres', defaultPort: 5432 }),
      expect.objectContaining({ engine: 'sqlite', connectionMode: 'file' }),
    ]));
  });
});
