import { describe, expect, it } from 'vitest';
import { pgPlaceholder, pgQuoteIdent, pgBuildListColumns, pgBuildListIndexes, pgBuildListTables } from './pg-sql';

describe('pg-sql quoting/placeholders', () => {
  it('double-quotes and escapes identifiers', () => {
    expect(pgQuoteIdent('a"b')).toBe('"a""b"');
  });
  it('uses $n placeholders', () => {
    expect(pgPlaceholder(1)).toBe('$1');
    expect(pgPlaceholder(3)).toBe('$3');
  });
});

describe('pg-sql metadata builders', () => {
  it('lists base tables excluding system schemas', () => {
    const { sql, params } = pgBuildListTables();
    expect(sql).toContain('information_schema.tables');
    expect(sql).toContain("table_type = 'BASE TABLE'");
    expect(params).toEqual([]);
  });
  it('builds column query bound to schema+table', () => {
    const { sql, params } = pgBuildListColumns({ namespace: 'public', name: 'users' });
    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(params).toEqual(['public', 'users']);
  });
  it('builds index query via pg_index bound to schema+table', () => {
    const { sql, params } = pgBuildListIndexes({ namespace: 'public', name: 'users' });
    expect(sql).toContain('pg_index');
    expect(params).toEqual(['public', 'users']);
  });
});
