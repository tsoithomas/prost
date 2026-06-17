import { describe, expect, it } from 'vitest';
import { pgPlaceholder, pgQuoteIdent, pgBuildListColumns, pgBuildListIndexes, pgBuildListTables } from './pg-sql';
import { pgBuildSelectRows, pgBuildInsertRow, pgBuildUpdateRow, pgBuildDeleteRow, pgBuildRowCountEstimate } from './pg-sql';

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

describe('pg-sql grid builders', () => {
  const ref = { namespace: 'public', name: 'users' };
  it('selects with order + limit/offset placeholders after where params', () => {
    const { sql, params } = pgBuildSelectRows(ref, {
      whereClause: 'WHERE "age" > $1', whereParams: [18], orderColumn: 'id', sortDir: 'ASC', limit: 100, offset: 0,
    });
    expect(sql).toBe('SELECT * FROM "public"."users" WHERE "age" > $1 ORDER BY "id" ASC LIMIT $2 OFFSET $3');
    expect(params).toEqual([18, 100, 0]);
  });
  it('inserts named columns with RETURNING *', () => {
    const { sql, params } = pgBuildInsertRow(ref, [['name', 'ada'], ['age', 36]]);
    expect(sql).toBe('INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2) RETURNING *');
    expect(params).toEqual(['ada', 36]);
  });
  it('inserts DEFAULT VALUES when no entries', () => {
    expect(pgBuildInsertRow(ref, []).sql).toBe('INSERT INTO "public"."users" DEFAULT VALUES RETURNING *');
  });
  it('updates one column keyed by pk with RETURNING *', () => {
    const { sql, params } = pgBuildUpdateRow(ref, 'name', 'ada', ['id'], [7]);
    expect(sql).toBe('UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2 RETURNING *');
    expect(params).toEqual(['ada', 7]);
  });
  it('deletes by composite pk', () => {
    const { sql, params } = pgBuildDeleteRow(ref, ['a', 'b'], [1, 2]);
    expect(sql).toBe('DELETE FROM "public"."users" WHERE "a" = $1 AND "b" = $2');
    expect(params).toEqual([1, 2]);
  });
  it('estimates row count via pg_class', () => {
    const { sql, params } = pgBuildRowCountEstimate(ref);
    expect(sql).toContain('reltuples');
    expect(params).toEqual(['public', 'users']);
  });
});
