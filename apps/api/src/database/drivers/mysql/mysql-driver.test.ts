import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata } from '@prost/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { DriverQueryFn, NativePool } from '../../types';
import { assertSupportedVersion, MysqlDriver } from './mysql-driver';

function createDriver(): MysqlDriver {
  return new MysqlDriver({ get: () => undefined } as unknown as ConfigService);
}

function column(name: string, options: Partial<ColumnMetadata> = {}): ColumnMetadata {
  return {
    name,
    dataType: 'int',
    nullable: false,
    isPrimaryKey: false,
    autoIncrement: false,
    defaultValue: null,
    ...options,
  };
}

describe('MysqlDriver query normalization', () => {
  it('normalizes SELECT rows and preserves raw numeric type codes', async () => {
    const query = vi.fn().mockResolvedValue([
      [{ id: 1, name: 'Ada' }],
      [
        { name: 'id', columnType: 3, type: 999 },
        { name: 'name', type: 253 },
      ],
    ]);
    const driver = createDriver();

    await expect(
      driver.query({ query } as unknown as NativePool, {
        sql: ' select id, name from users',
        params: [],
      }),
    ).resolves.toEqual({
      rows: [{ id: 1, name: 'Ada' }],
      fields: [
        { name: 'id', dataTypeID: 3, dataTypeName: undefined },
        { name: 'name', dataTypeID: 253, dataTypeName: undefined },
      ],
      rowCount: 1,
      command: 'SELECT',
      lastInsertId: undefined,
    });
    expect(query).toHaveBeenCalledWith({
      sql: ' select id, name from users',
      values: [],
      timeout: 30_000,
    });
  });

  it('normalizes OK headers including affected rows and insert id', async () => {
    const query = vi.fn().mockResolvedValue([{ affectedRows: 2, insertId: 41 }, undefined]);
    const driver = createDriver();

    await expect(
      driver.query({ query } as unknown as NativePool, {
        sql: '\nINSERT INTO users (name) VALUES (?)',
        params: ['Ada'],
      }),
    ).resolves.toEqual({
      rows: [],
      fields: [],
      rowCount: 2,
      command: 'INSERT',
      lastInsertId: 41,
    });
  });
});

describe('assertSupportedVersion', () => {
  it.each(['8.0.39', '8.4.0'])('accepts supported MySQL version %s', (version) => {
    expect(() => assertSupportedVersion(version)).not.toThrow();
  });

  it('rejects MySQL 5.7', () => {
    expect(() => assertSupportedVersion('5.7.44')).toThrow(/MySQL 8\.0 or newer/);
  });

  it.each(['10.11.8-MariaDB', '8.0.39-mariadb'])('rejects MariaDB version %s', (version) => {
    expect(() => assertSupportedVersion(version)).toThrow(/MariaDB/);
  });
});

describe('MysqlDriver sessions and transactions', () => {
  it('commits a successful transaction and releases the connection', async () => {
    const conn = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn().mockResolvedValue([[{ id: 1 }], [{ name: 'id', columnType: 3 }]]),
    };
    const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
    const driver = createDriver();

    await expect(
      driver.withTransaction(pool as unknown as NativePool, (q) =>
        q({ sql: 'SELECT id FROM users', params: [] }),
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 1 }],
      command: 'SELECT',
    });
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it('rolls back a failed transaction and releases the connection', async () => {
    const failure = new Error('write failed');
    const conn = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn(),
    };
    const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
    const driver = createDriver();

    await expect(
      driver.withTransaction(pool as unknown as NativePool, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it('runs a session without beginning a transaction and releases the connection', async () => {
    const conn = {
      beginTransaction: vi.fn(),
      release: vi.fn(),
      query: vi.fn().mockResolvedValue([[{ id: 1 }], [{ name: 'id', columnType: 3 }]]),
    };
    const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
    const driver = createDriver();

    await driver.withSession(pool as unknown as NativePool, (q) =>
      q({ sql: 'SELECT id FROM users', params: [] }),
    );
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
});

describe('MysqlDriver insertRow', () => {
  const ref = { namespace: 'app', name: 'users' };

  it('re-selects a row by a completely supplied primary key', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [],
        fields: [],
        rowCount: 1,
        command: 'INSERT',
        lastInsertId: 0,
      })
      .mockResolvedValueOnce({
        rows: [{ tenant_id: 7, id: 9, name: 'Ada' }],
        fields: [],
        rowCount: 1,
        command: 'SELECT',
      });
    const driver = createDriver();

    await expect(
      driver.insertRow(
        q as DriverQueryFn,
        ref,
        [
          ['tenant_id', 7],
          ['id', 9],
          ['name', 'Ada'],
        ],
        [
          column('tenant_id', { isPrimaryKey: true }),
          column('id', { isPrimaryKey: true }),
          column('name', { dataType: 'varchar' }),
        ],
      ),
    ).resolves.toEqual({ tenant_id: 7, id: 9, name: 'Ada' });
    expect(q.mock.calls[1]![0]).toEqual({
      sql: 'SELECT * FROM `app`.`users` WHERE `tenant_id` = ? AND `id` = ?',
      params: [7, 9],
    });
  });

  it('fills one missing AUTO_INCREMENT primary-key component from insertId', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [],
        fields: [],
        rowCount: 1,
        command: 'INSERT',
        lastInsertId: 42,
      })
      .mockResolvedValueOnce({
        rows: [{ tenant_id: 7, id: 42 }],
        fields: [],
        rowCount: 1,
        command: 'SELECT',
      });
    const driver = createDriver();

    await expect(
      driver.insertRow(
        q as DriverQueryFn,
        ref,
        [['tenant_id', 7]],
        [
          column('tenant_id', { isPrimaryKey: true }),
          column('id', { isPrimaryKey: true, autoIncrement: true }),
        ],
      ),
    ).resolves.toEqual({ tenant_id: 7, id: 42 });
    expect(q.mock.calls[1]![0].params).toEqual([7, 42]);
  });

  it('allows a default-only insert for a lone AUTO_INCREMENT primary key', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [],
        fields: [],
        rowCount: 1,
        command: 'INSERT',
        lastInsertId: 42,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 42 }],
        fields: [],
        rowCount: 1,
        command: 'SELECT',
      });
    const driver = createDriver();

    await expect(
      driver.insertRow(
        q as DriverQueryFn,
        ref,
        [],
        [column('id', { isPrimaryKey: true, autoIncrement: true })],
      ),
    ).resolves.toEqual({ id: 42 });
    expect(q.mock.calls[0]![0]).toEqual({
      sql: 'INSERT INTO `app`.`users` () VALUES ()',
      params: [],
    });
    expect(q.mock.calls[1]![0]).toEqual({
      sql: 'SELECT * FROM `app`.`users` WHERE `id` = ?',
      params: [42],
    });
  });

  it.each([
    {
      name: 'no primary key',
      entries: [['name', 'Ada']] as [string, unknown][],
      columns: [column('name')],
    },
    {
      name: 'more than one missing primary-key component',
      entries: [['name', 'Ada']] as [string, unknown][],
      columns: [
        column('tenant_id', { isPrimaryKey: true }),
        column('id', { isPrimaryKey: true, autoIncrement: true }),
      ],
    },
    {
      name: 'a missing non-auto-increment component',
      entries: [['name', 'Ada']] as [string, unknown][],
      columns: [column('id', { isPrimaryKey: true })],
    },
    {
      name: 'a default-only insert without a lone AUTO_INCREMENT primary key',
      entries: [] as [string, unknown][],
      columns: [
        column('tenant_id', { isPrimaryKey: true }),
        column('id', { isPrimaryKey: true, autoIncrement: true }),
      ],
    },
  ])('rejects $name before executing INSERT', async ({ entries, columns }) => {
    const q = vi.fn();
    const driver = createDriver();

    const result = driver.insertRow(q as DriverQueryFn, ref, entries, columns);
    await expect(result).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(result).rejects.toMatchObject({ status: 422 });
    expect(q).not.toHaveBeenCalled();
  });
});

describe('MysqlDriver updateRow', () => {
  const ref = { namespace: 'app', name: 'users' };

  it.each([
    { affectedRows: 1, label: 'changed' },
    { affectedRows: 0, label: 'same-value' },
  ])('returns the re-selected row after a $label update', async ({ affectedRows }) => {
    const q = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], fields: [], rowCount: affectedRows, command: 'UPDATE' })
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: 'Ada' }],
        fields: [],
        rowCount: 1,
        command: 'SELECT',
      });
    const driver = createDriver();

    await expect(
      driver.updateRow(q as DriverQueryFn, ref, 'name', 'Ada', ['id'], [4]),
    ).resolves.toEqual({ id: 4, name: 'Ada' });
    expect(q.mock.calls[1]![0].params).toEqual([4]);
  });

  it('throws NotFoundException when the re-select finds no row', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], fields: [], rowCount: 0, command: 'UPDATE' })
      .mockResolvedValueOnce({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
    const driver = createDriver();

    await expect(
      driver.updateRow(q as DriverQueryFn, ref, 'name', 'Ada', ['id'], [4]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-selects a primary-key-changing update by the new key', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], fields: [], rowCount: 1, command: 'UPDATE' })
      .mockResolvedValueOnce({
        rows: [{ tenant_id: 7, id: 8 }],
        fields: [],
        rowCount: 1,
        command: 'SELECT',
      });
    const driver = createDriver();

    await driver.updateRow(q as DriverQueryFn, ref, 'id', 8, ['tenant_id', 'id'], [7, 4]);
    expect(q.mock.calls[1]![0]).toEqual({
      sql: 'SELECT * FROM `app`.`users` WHERE `tenant_id` = ? AND `id` = ?',
      params: [7, 8],
    });
  });
});

describe('MysqlDriver result metadata', () => {
  it('maps numeric mysql2 codes without using the query callback', async () => {
    const query = vi.fn();
    const driver = createDriver();

    await expect(
      driver.describeResultColumns(
        query,
        [
          { name: 'id', dataTypeID: 3 },
          { name: 'payload', dataTypeID: 245 },
          { name: 'mystery', dataTypeID: 9999 },
        ],
        ['id'],
      ),
    ).resolves.toEqual([
      {
        name: 'id',
        dataType: 'int',
        nullable: true,
        isPrimaryKey: true,
        autoIncrement: false,
        defaultValue: null,
      },
      {
        name: 'payload',
        dataType: 'json',
        nullable: true,
        isPrimaryKey: false,
        autoIncrement: false,
        defaultValue: null,
      },
      {
        name: 'mystery',
        dataType: 'unknown',
        nullable: true,
        isPrimaryKey: false,
        autoIncrement: false,
        defaultValue: null,
      },
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('advertises only the btree index method', () => {
    expect(createDriver().descriptor.ddl.indexMethods).toEqual(['btree']);
  });
});
