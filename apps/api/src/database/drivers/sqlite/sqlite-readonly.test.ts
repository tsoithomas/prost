import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteDriver } from './sqlite-driver';
import type { NativePool } from '../../types';

const config = { get: () => undefined } as unknown as ConfigService;

/**
 * The app-DB self-connection is opened `readonly`. SQLite must reject writes at the engine level —
 * this is the hard guarantee behind read-only inspection (the service guard is belt-and-braces).
 */
describe('SqliteDriver read-only handle', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prost-ro-'));
  const file = path.join(dir, 'app.db');
  const driver = new SqliteDriver(config);
  let ro: NativePool;

  beforeAll(async () => {
    // Pre-create + seed the file the way Prisma owns the real app DB; the driver only ever reads it.
    const seed = new Database(file);
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    seed.prepare('INSERT INTO t (id, v) VALUES (1, ?)').run('a');
    seed.close();

    ro = await driver.createPool({
      host: '', port: 0, database: file, username: '', password: '', sslEnabled: false, sslRejectUnauthorized: true, readOnly: true,
    });
  });

  afterAll(async () => {
    await driver.closePool(ro).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads rows through the read-only handle', async () => {
    const r = await driver.query(ro, driver.buildSelectRows({ name: 't' }, { whereClause: '', whereParams: [], sortDir: 'ASC', limit: 10, offset: 0 }));
    expect(r.rows).toHaveLength(1);
  });

  it('rejects writes through the read-only handle', async () => {
    await expect(
      driver.query(ro, driver.buildInsertRow({ name: 't' }, [['id', 2], ['v', 'b']])),
    ).rejects.toThrow(/readonly|read-only/i);
  });
});
