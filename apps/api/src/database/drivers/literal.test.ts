import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import { pgFormatLiteral, pgQualifyTable } from './pg/pg-sql';
import { mysqlFormatLiteral, mysqlQualifyTable } from './mysql/mysql-sql';
import { sqliteFormatLiteral, sqliteQualifyTable } from './sqlite/sqlite-sql';

const col = (dataType = 'text'): ColumnMetadata => ({
  name: 'c', dataType, nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null,
});

describe('formatLiteral — shared value handling', () => {
  it.each([pgFormatLiteral, mysqlFormatLiteral, sqliteFormatLiteral])('renders null/number/bool consistently', (fmt) => {
    expect(fmt(null, col())).toBe('NULL');
    expect(fmt(undefined, col())).toBe('NULL');
    expect(fmt(42, col('integer'))).toBe('42');
    expect(fmt(3.5, col('numeric'))).toBe('3.5');
    expect(fmt(Number.NaN, col('numeric'))).toBe('NULL');
  });

  it.each([pgFormatLiteral, mysqlFormatLiteral, sqliteFormatLiteral])('quotes a plain string', (fmt) => {
    expect(fmt('hi', col())).toBe("'hi'");
  });
});

describe('pgFormatLiteral', () => {
  it('doubles single quotes and leaves backslash literal (standard strings)', () => {
    expect(pgFormatLiteral("a'b", col())).toBe("'a''b'");
    expect(pgFormatLiteral('a\\b', col())).toBe("'a\\b'");
  });
  it('booleans are TRUE/FALSE', () => {
    expect(pgFormatLiteral(true, col('boolean'))).toBe('TRUE');
    expect(pgFormatLiteral(false, col('boolean'))).toBe('FALSE');
  });
  it('binary is bytea hex', () => {
    expect(pgFormatLiteral(Buffer.from('AB', 'hex'), col('bytea'))).toBe("'\\xab'");
  });
  it('objects become quoted JSON', () => {
    expect(pgFormatLiteral({ a: 1 }, col('jsonb'))).toBe('\'{"a":1}\'');
  });
});

describe('mysqlFormatLiteral', () => {
  it('escapes backslash and single quote with backslashes', () => {
    expect(mysqlFormatLiteral('a\\b', col())).toBe("'a\\\\b'");
    expect(mysqlFormatLiteral("a'b", col())).toBe("'a\\'b'");
  });
  it('booleans are 1/0', () => {
    expect(mysqlFormatLiteral(true, col('tinyint'))).toBe('1');
    expect(mysqlFormatLiteral(false, col('tinyint'))).toBe('0');
  });
  it('binary is X\'..\'', () => {
    expect(mysqlFormatLiteral(Buffer.from('AB', 'hex'), col('blob'))).toBe("X'ab'");
  });
});

describe('sqliteFormatLiteral', () => {
  it('doubles single quotes (standard) and 1/0 booleans, X\'..\' blobs', () => {
    expect(sqliteFormatLiteral("a'b", col())).toBe("'a''b'");
    expect(sqliteFormatLiteral(true, col('integer'))).toBe('1');
    expect(sqliteFormatLiteral(Buffer.from('AB', 'hex'), col('blob'))).toBe("X'ab'");
  });
});

describe('qualifyTable', () => {
  it('quotes schema.table per dialect', () => {
    expect(pgQualifyTable({ namespace: 'public', name: 'users' })).toBe('"public"."users"');
    expect(mysqlQualifyTable({ namespace: 'shop', name: 'orders' })).toBe('`shop`.`orders`');
    expect(sqliteQualifyTable({ name: 'users' })).toBe('"users"');
  });
});
