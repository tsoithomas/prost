import { describe, expect, it } from 'vitest';
import { pgPlaceholder, pgQuoteIdent, pgBuildListAllColumns, pgBuildListColumns, pgBuildListIndexes, pgBuildListTables } from './pg-sql';
import { pgBuildSelectRows, pgBuildInsertRow, pgBuildUpdateRow, pgBuildUpdateRowGuarded, pgBuildDeleteRow, pgBuildRowCountEstimate } from './pg-sql';
import { pgBuildCreateTable, pgBuildAlterTable, pgBuildCreateIndex, pgBuildDropIndex, pgBuildResolveTypeNames } from './pg-sql';
import { pgBuildSchemaTableStats, pgBuildDropTable, pgBuildTruncateTable } from './pg-sql';

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
    expect(sql).toContain('c.column_default AS default_value');
    expect(sql).toContain("(c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%') AS is_auto_increment");
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(params).toEqual(['public', 'users']);
  });
  it('includes defaults and auto-increment metadata when listing all columns', () => {
    const { sql, params } = pgBuildListAllColumns();
    expect(sql).toContain('c.column_default AS default_value');
    expect(sql).toContain("(c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%') AS is_auto_increment");
    expect(params).toEqual([]);
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
  it('includes the __version projection when includeVersion is set', () => {
    const { sql } = pgBuildSelectRows(ref, {
      whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 10, offset: 0, includeVersion: true,
    });
    expect(sql).toBe('SELECT *, xmin::text AS "__version" FROM "public"."users" ORDER BY "id" ASC LIMIT $1 OFFSET $2');
  });
  it('guarded update with a version token matches on xmin and re-projects __version', () => {
    const { sql, params } = pgBuildUpdateRowGuarded(
      ref, [['name', 'ada'], ['age', 36]], ['id'], [7], { kind: 'version', value: '512' },
    );
    expect(sql).toBe(
      'UPDATE "public"."users" SET "name" = $1, "age" = $2 WHERE "id" = $3 AND xmin = $4::xid RETURNING *, xmin::text AS "__version"',
    );
    expect(params).toEqual(['ada', 36, 7, '512']);
  });
  it('guarded update with a preimage matches each old value via IS NOT DISTINCT FROM', () => {
    const { sql, params } = pgBuildUpdateRowGuarded(
      ref, [['name', 'ada']], ['id'], [7], { kind: 'preimage', columns: ['name'], values: [null] },
    );
    expect(sql).toBe(
      'UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2 AND "name" IS NOT DISTINCT FROM $3 RETURNING *, xmin::text AS "__version"',
    );
    expect(params).toEqual(['ada', 7, null]);
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
  it('builds schema table stats bound to the namespace with the expected aliases', () => {
    const { sql, params } = pgBuildSchemaTableStats('public');
    expect(params).toEqual(['public']);
    expect(sql).toContain('n.nspname = $1');
    expect(sql).not.toMatch(/nspname = 'public'/); // parameterized, never interpolated
    for (const alias of ['table_name', 'row_estimate', 'size_bytes', 'column_count', 'index_count', 'engine', 'collation', 'comment']) {
      expect(sql).toContain(alias);
    }
    expect(sql).toContain('pg_total_relation_size');
  });
});

describe('pg-sql drop/truncate builders', () => {
  const ref = { namespace: 'public', name: 'users' };
  it('drops a table with quoted identifiers and no params', () => {
    expect(pgBuildDropTable(ref)).toEqual({ sql: 'DROP TABLE "public"."users"', params: [] });
  });
  it('truncates a table with quoted identifiers and no params', () => {
    expect(pgBuildTruncateTable(ref)).toEqual({ sql: 'TRUNCATE TABLE "public"."users"', params: [] });
  });
});

describe('pg-sql ddl builders', () => {
  it('builds CREATE TABLE with PK constraint', () => {
    const { sql } = pgBuildCreateTable({
      schema: 'public', table: 't',
      columns: [{ name: 'id', type: 'integer', nullable: false, isPrimaryKey: true }],
    });
    expect(sql).toContain('CREATE TABLE "public"."t"');
    expect(sql).toContain('PRIMARY KEY ("id")');
  });
  it('builds ADD COLUMN alter', () => {
    const { sql } = pgBuildAlterTable({ namespace: 'public', name: 't' },
      { kind: 'addColumn', column: { name: 'c', type: 'text', nullable: true, isPrimaryKey: false } });
    expect(sql).toBe('ALTER TABLE "public"."t" ADD COLUMN "c" text');
  });
  it('builds CREATE INDEX', () => {
    const { sql } = pgBuildCreateIndex({ schema: 'public', table: 't', columns: ['a'], unique: true }, 't_a_idx', 'btree');
    expect(sql).toBe('CREATE UNIQUE INDEX "t_a_idx" ON "public"."t" USING btree ("a")');
  });
  it('builds DROP INDEX', () => {
    expect(pgBuildDropIndex({ namespace: 'public', name: 'i' }, 'i').sql).toBe('DROP INDEX "public"."i"');
  });
  it('resolves type names by oid array', () => {
    const { sql, params } = pgBuildResolveTypeNames([23, 25]);
    expect(sql).toContain('pg_type');
    expect(params).toEqual([[23, 25]]);
  });
});
