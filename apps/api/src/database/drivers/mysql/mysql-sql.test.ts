import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  mysqlBuildAlterTable,
  mysqlBuildCreateIndex,
  mysqlBuildCreateTable,
  mysqlBuildDeleteRow,
  mysqlBuildDropIndex,
  mysqlBuildFilteredRowCount,
  mysqlBuildInsertRow,
  mysqlBuildListAllColumns,
  mysqlBuildListColumns,
  mysqlBuildListIndexes,
  mysqlBuildListTables,
  mysqlBuildRowCountEstimate,
  mysqlBuildSelectByPk,
  mysqlBuildSelectRows,
  mysqlBuildUpdateRow,
  mysqlFormatExplain,
  mysqlInList,
  mysqlNormalizeAlterTable,
  mysqlNormalizeCreateIndex,
  mysqlNormalizeCreateTable,
  mysqlPlaceholder,
  mysqlQualify,
  mysqlQuoteIdent,
  mysqlTypeName,
} from './mysql-sql';

describe('mysql dialect helpers', () => {
  it('backtick-quotes identifiers and doubles embedded backticks', () => {
    expect(mysqlQuoteIdent('users')).toBe('`users`');
    expect(mysqlQuoteIdent('a`b')).toBe('`a``b`');
  });

  it('rejects invalid identifiers', () => {
    expect(() => mysqlQuoteIdent('')).toThrow('Identifier must not be empty');
    expect(() => mysqlQuoteIdent('a\u0000b')).toThrow('Identifier must not contain null bytes');
  });

  it('always emits positional placeholders', () => {
    expect(mysqlPlaceholder(1)).toBe('?');
    expect(mysqlPlaceholder(99)).toBe('?');
  });

  it('qualifies tables with the connection database namespace', () => {
    expect(mysqlQualify({ namespace: 'app_db', name: 'users' })).toBe('`app_db`.`users`');
    expect(mysqlQualify({ name: 'users' })).toBe('`users`');
  });

  it('builds IN lists and handles empty lists', () => {
    expect(mysqlInList('`id`', [1, 2], false, 7)).toEqual({
      fragment: '`id` IN (?, ?)',
      params: [1, 2],
    });
    expect(mysqlInList('`id`', [], false, 1)).toEqual({ fragment: '1=0', params: [] });
    expect(mysqlInList('`id`', [], true, 1)).toEqual({ fragment: '1=1', params: [] });
  });
});

describe('mysql metadata builders', () => {
  it('lists base tables only from DATABASE()', () => {
    const frag = mysqlBuildListTables();
    expect(frag.sql).toContain('FROM information_schema.tables');
    expect(frag.sql).toContain('TABLE_SCHEMA = DATABASE()');
    expect(frag.sql).toContain("TABLE_TYPE = 'BASE TABLE'");
    expect(frag.sql).toContain('ORDER BY TABLE_NAME');
    expect(frag.params).toEqual([]);
  });

  it('lists all columns using the metadata alias contract', () => {
    const frag = mysqlBuildListAllColumns();
    expect(frag.sql).toContain('TABLE_SCHEMA AS table_schema');
    expect(frag.sql).toContain('TABLE_NAME AS table_name');
    expect(frag.sql).toContain('COLUMN_NAME AS column_name');
    expect(frag.sql).toContain('DATA_TYPE AS data_type');
    expect(frag.sql).toContain('IS_NULLABLE AS is_nullable');
    expect(frag.sql).toContain('COLUMN_DEFAULT AS default_value');
    expect(frag.sql).toContain("COLUMN_KEY = 'PRI'");
    expect(frag.sql).toContain('AS is_primary_key');
    expect(frag.sql).toContain("EXTRA LIKE '%auto_increment%'");
    expect(frag.sql).toContain('AS is_auto_increment');
    expect(frag.sql).toContain('TABLE_SCHEMA = DATABASE()');
    expect(frag.params).toEqual([]);
  });

  it('binds a TableRef database and table for column metadata', () => {
    const frag = mysqlBuildListColumns({ namespace: 'app_db', name: 'orders' });
    expect(frag.sql).toContain('FROM information_schema.columns');
    expect(frag.sql).toContain('TABLE_SCHEMA = ? AND TABLE_NAME = ?');
    expect(frag.sql).toContain('COLUMN_DEFAULT AS default_value');
    expect(frag.sql).toContain("COLUMN_KEY = 'PRI'");
    expect(frag.sql).toContain("EXTRA LIKE '%auto_increment%'");
    expect(frag.params).toEqual(['app_db', 'orders']);
  });

  it('aggregates index columns as stable ordered JSON', () => {
    const frag = mysqlBuildListIndexes({ namespace: 'app_db', name: 'orders' });
    expect(frag.sql).toContain('FROM information_schema.statistics');
    expect(frag.sql).toContain('TABLE_SCHEMA = ? AND TABLE_NAME = ?');
    expect(frag.sql).toContain('ORDER BY SEQ_IN_INDEX');
    expect(frag.sql).toContain('JSON_ARRAYAGG');
    expect(frag.sql).toContain('AS columns');
    expect(frag.sql).toContain('LOWER(INDEX_TYPE) AS method');
    expect(frag.params).toEqual(['app_db', 'orders']);
  });
});

describe('mysql grid builders', () => {
  const ref = { namespace: 'app_db', name: 'users' };

  it('selects qualified rows with filtering, ordering, and pagination', () => {
    expect(mysqlBuildSelectRows(ref, {
      whereClause: 'WHERE `age` > ?',
      whereParams: [18],
      orderColumn: 'id',
      sortDir: 'DESC',
      limit: 25,
      offset: 50,
    })).toEqual({
      sql: 'SELECT * FROM `app_db`.`users` WHERE `age` > ? ORDER BY `id` DESC LIMIT ? OFFSET ?',
      params: [18, 25, 50],
    });
  });

  it('counts filtered rows', () => {
    expect(mysqlBuildFilteredRowCount(ref, 'WHERE `active` = ?', [true])).toEqual({
      sql: 'SELECT COUNT(*) AS count FROM `app_db`.`users` WHERE `active` = ?',
      params: [true],
    });
  });

  it('estimates rows from information_schema for one database', () => {
    const frag = mysqlBuildRowCountEstimate(ref);
    expect(frag.sql).toContain('TABLE_ROWS AS reltuples');
    expect(frag.sql).toContain('TABLE_SCHEMA = ? AND TABLE_NAME = ?');
    expect(frag.params).toEqual(['app_db', 'users']);
  });

  it('inserts bound values without RETURNING', () => {
    expect(mysqlBuildInsertRow(ref, [['name', 'Ada'], ['age', 36]])).toEqual({
      sql: 'INSERT INTO `app_db`.`users` (`name`, `age`) VALUES (?, ?)',
      params: ['Ada', 36],
    });
  });

  it('emits MySQL empty-column insert syntax', () => {
    expect(mysqlBuildInsertRow(ref, [])).toEqual({
      sql: 'INSERT INTO `app_db`.`users` () VALUES ()',
      params: [],
    });
  });

  it('updates and deletes by composite primary key without RETURNING', () => {
    expect(mysqlBuildUpdateRow(ref, 'name', 'Grace', ['tenant', 'id'], ['acme', 7])).toEqual({
      sql: 'UPDATE `app_db`.`users` SET `name` = ? WHERE `tenant` = ? AND `id` = ?',
      params: ['Grace', 'acme', 7],
    });
    expect(mysqlBuildDeleteRow(ref, ['tenant', 'id'], ['acme', 7])).toEqual({
      sql: 'DELETE FROM `app_db`.`users` WHERE `tenant` = ? AND `id` = ?',
      params: ['acme', 7],
    });
  });

  it('selects a persisted row by primary key', () => {
    expect(mysqlBuildSelectByPk(ref, ['tenant', 'id'], ['acme', 7])).toEqual({
      sql: 'SELECT * FROM `app_db`.`users` WHERE `tenant` = ? AND `id` = ?',
      params: ['acme', 7],
    });
  });
});

describe('mysql ddl builders and normalization', () => {
  it('normalizes common MySQL types, defaults, primary keys, and AUTO_INCREMENT', () => {
    expect(mysqlNormalizeCreateTable({
      schema: 'app_db',
      table: 'users',
      columns: [
        { name: 'id', type: ' bigint ', nullable: true, isPrimaryKey: true, autoIncrement: true },
        { name: 'email', type: 'VARCHAR(255)', nullable: false, isPrimaryKey: false, default: ' null ' },
        { name: 'created_at', type: 'datetime', nullable: false, isPrimaryKey: false, default: 'CURRENT_TIMESTAMP' },
      ],
    })).toEqual({
      schema: 'app_db',
      table: 'users',
      columns: [
        { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, autoIncrement: true },
        { name: 'email', type: 'VARCHAR(255)', nullable: false, isPrimaryKey: false, default: 'null' },
        { name: 'created_at', type: 'DATETIME', nullable: false, isPrimaryKey: false, default: 'current_timestamp' },
      ],
    });
  });

  it('rejects unsupported types', () => {
    expect(() => mysqlNormalizeCreateTable({
      schema: 'app_db',
      table: 'bad',
      columns: [{ name: 'x', type: 'MONEY', nullable: true, isPrimaryKey: false }],
    })).toThrow(UnprocessableEntityException);
  });

  it('normalizes alter operations and rejects conflicts', () => {
    const columns = [{
      name: 'amount',
      dataType: 'decimal(10,2)',
      nullable: true,
      isPrimaryKey: false,
      autoIncrement: false,
      defaultValue: null,
    }];
    expect(mysqlNormalizeAlterTable(
      { namespace: 'app_db', name: 'orders' },
      { kind: 'changeType', column: 'amount', type: 'DECIMAL(12, 4)' },
      columns,
    )).toMatchObject({ kind: 'changeType', column: 'amount', type: 'DECIMAL(12,4)' });
    expect(() => mysqlNormalizeAlterTable(
      { namespace: 'app_db', name: 'orders' },
      { kind: 'addColumn', column: { name: 'amount', type: 'INT', nullable: true, isPrimaryKey: false } },
      columns,
    )).toThrow(ConflictException);
  });

  it('creates tables with AUTO_INCREMENT and a table primary key', () => {
    const frag = mysqlBuildCreateTable({
      schema: 'app_db',
      table: 'users',
      columns: [
        { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, autoIncrement: true },
        { name: 'name', type: 'VARCHAR(255)', nullable: false, isPrimaryKey: false },
      ],
    });
    expect(frag.sql).toContain('CREATE TABLE `app_db`.`users`');
    expect(frag.sql).toContain('`id` BIGINT NOT NULL AUTO_INCREMENT');
    expect(frag.sql).toContain('PRIMARY KEY (`id`)');
  });

  it('uses MODIFY COLUMN for MySQL type changes', () => {
    expect(mysqlBuildAlterTable(
      { namespace: 'app_db', name: 'users' },
      { kind: 'changeType', column: 'age', type: 'BIGINT' },
    ).sql).toBe('ALTER TABLE `app_db`.`users` MODIFY COLUMN `age` BIGINT');
  });

  it('creates BTREE indexes and drops them on a qualified table', () => {
    expect(mysqlBuildCreateIndex(
      { schema: 'app_db', table: 'users', columns: ['email'], unique: true },
      'users_email_idx',
      'btree',
    ).sql).toBe('CREATE UNIQUE INDEX `users_email_idx` USING BTREE ON `app_db`.`users` (`email`)');
    expect(mysqlBuildDropIndex(
      { namespace: 'app_db', name: 'users' },
      'users_email_idx',
    ).sql).toBe('DROP INDEX `users_email_idx` ON `app_db`.`users`');
  });

  it('accepts only BTREE and truncates derived names to 63 characters', () => {
    const request = {
      schema: 'app_db',
      table: 'a'.repeat(40),
      columns: ['b'.repeat(40)],
      unique: false,
    };
    const normalized = mysqlNormalizeCreateIndex(request);
    expect(normalized.method).toBe('btree');
    expect(normalized.name).toHaveLength(63);
    expect(normalized.name.endsWith('_idx')).toBe(true);
    expect(() => mysqlNormalizeCreateIndex({ ...request, method: 'hash' }))
      .toThrow(UnprocessableEntityException);
  });
});

describe('mysql result helpers', () => {
  it('maps representative mysql2 type codes', () => {
    expect(mysqlTypeName(3)).toBe('int');
    expect(mysqlTypeName(8)).toBe('bigint');
    expect(mysqlTypeName(246)).toBe('decimal');
    expect(mysqlTypeName(253)).toBe('varchar');
    expect(mysqlTypeName(254)).toBe('string');
    expect(mysqlTypeName(252)).toBe('text/blob');
    expect(mysqlTypeName(249)).toBe('tinyblob');
    expect(mysqlTypeName(7)).toBe('timestamp');
    expect(mysqlTypeName(12)).toBe('datetime');
    expect(mysqlTypeName(10)).toBe('date');
    expect(mysqlTypeName(11)).toBe('time');
    expect(mysqlTypeName(245)).toBe('json');
    expect(mysqlTypeName(999)).toBe('unknown');
  });

  it('formats EXPLAIN rows as readable lines', () => {
    expect(mysqlFormatExplain([
      { id: 1, select_type: 'SIMPLE', table: 'users', type: 'ALL' },
      { id: 2, select_type: 'SUBQUERY', table: 'orders', type: 'ref' },
    ])).toBe(
      'id=1 | select_type=SIMPLE | table=users | type=ALL\n'
      + 'id=2 | select_type=SUBQUERY | table=orders | type=ref',
    );
  });
});
