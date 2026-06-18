import { describe, expect, it } from 'vitest';
import {
  sqliteBuildCreateIndex,
  sqliteBuildCreateTable,
  sqliteBuildDeleteRow,
  sqliteBuildDropIndex,
  sqliteBuildFilteredRowCount,
  sqliteBuildInsertRow,
  sqliteBuildListAllColumns,
  sqliteBuildListColumns,
  sqliteBuildRowCountEstimate,
  sqliteBuildSelectRows,
  sqliteBuildUpdateRow,
  sqliteBuildUpdateRowGuarded,
  sqlitePlaceholder,
  sqliteQuoteIdent,
} from './sqlite-sql';

describe('sqlite dialect helpers', () => {
  it('double-quotes identifiers and doubles embedded quotes', () => {
    expect(sqliteQuoteIdent('users')).toBe('"users"');
    expect(sqliteQuoteIdent('a"b')).toBe('"a""b"');
  });

  it('always emits a positional ? placeholder', () => {
    expect(sqlitePlaceholder(1)).toBe('?');
    expect(sqlitePlaceholder(7)).toBe('?');
  });
});

describe('sqlite metadata builders', () => {
  it('binds the table name twice and only marks a single INTEGER primary key as auto-increment', () => {
    const frag = sqliteBuildListColumns({ namespace: 'main', name: 'orders' });
    expect(frag.sql).toContain('pragma_table_info(?)');
    expect(frag.sql).toContain('dflt_value AS default_value');
    expect(frag.sql).toContain("pk = 1 AND UPPER(type) = 'INTEGER'");
    expect(frag.sql).toContain('(SELECT COUNT(*) FROM pragma_table_info(?) WHERE pk > 0) = 1');
    expect(frag.sql).toContain('AS is_auto_increment');
    expect(frag.sql).not.toContain("'orders'");
    expect(frag.params).toEqual(['orders', 'orders']);
  });

  it('uses the current table name to reject composite primary keys when listing all columns', () => {
    const frag = sqliteBuildListAllColumns();
    expect(frag.sql).toContain('ti.dflt_value AS default_value');
    expect(frag.sql).toContain("ti.pk = 1 AND UPPER(ti.type) = 'INTEGER'");
    expect(frag.sql).toContain('(SELECT COUNT(*) FROM pragma_table_info(m.name) WHERE pk > 0) = 1');
    expect(frag.sql).toContain('AS is_auto_increment');
    expect(frag.params).toEqual([]);
  });
});

describe('sqlite grid builders', () => {
  it('builds a qualified SELECT with ? LIMIT/OFFSET and ordered params', () => {
    const frag = sqliteBuildSelectRows(
      { namespace: 'main', name: 'users' },
      { whereClause: '', whereParams: [], orderColumn: 'id', sortDir: 'ASC', limit: 50, offset: 10 },
    );
    expect(frag.sql).toBe('SELECT * FROM "main"."users" ORDER BY "id" ASC LIMIT ? OFFSET ?');
    expect(frag.params).toEqual([50, 10]);
  });

  it('places whereParams before limit/offset', () => {
    const frag = sqliteBuildSelectRows(
      { namespace: 'main', name: 'users' },
      { whereClause: 'WHERE "email" = ?', whereParams: ['a@b.com'], orderColumn: 'id', sortDir: 'DESC', limit: 5, offset: 0 },
    );
    expect(frag.sql).toBe('SELECT * FROM "main"."users" WHERE "email" = ? ORDER BY "id" DESC LIMIT ? OFFSET ?');
    expect(frag.params).toEqual(['a@b.com', 5, 0]);
  });

  it('estimates the row count as COUNT(*) aliased to reltuples', () => {
    const frag = sqliteBuildRowCountEstimate({ namespace: 'main', name: 'users' });
    expect(frag.sql).toBe('SELECT COUNT(*) AS reltuples FROM "main"."users"');
    expect(frag.params).toEqual([]);
  });

  it('counts filtered rows with the precompiled where clause', () => {
    const frag = sqliteBuildFilteredRowCount({ namespace: 'main', name: 'users' }, 'WHERE "id" = ?', [1]);
    expect(frag.sql).toBe('SELECT COUNT(*) AS count FROM "main"."users" WHERE "id" = ?');
    expect(frag.params).toEqual([1]);
  });

  it('inserts with RETURNING * and bound values', () => {
    const frag = sqliteBuildInsertRow({ namespace: 'main', name: 'users' }, [['email', 'a@b.com'], ['name', 'A']]);
    expect(frag.sql).toBe('INSERT INTO "main"."users" ("email", "name") VALUES (?, ?) RETURNING *');
    expect(frag.params).toEqual(['a@b.com', 'A']);
  });

  it('inserts DEFAULT VALUES when there are no entries', () => {
    const frag = sqliteBuildInsertRow({ namespace: 'main', name: 'users' }, []);
    expect(frag.sql).toBe('INSERT INTO "main"."users" DEFAULT VALUES RETURNING *');
  });

  it('updates a single column keyed by a composite primary key', () => {
    const frag = sqliteBuildUpdateRow({ namespace: 'main', name: 'users' }, 'name', 'B', ['org', 'id'], ['acme', 7]);
    expect(frag.sql).toBe('UPDATE "main"."users" SET "name" = ? WHERE "org" = ? AND "id" = ? RETURNING *');
    expect(frag.params).toEqual(['B', 'acme', 7]);
  });

  it('deletes keyed by primary key without RETURNING', () => {
    const frag = sqliteBuildDeleteRow({ namespace: 'main', name: 'users' }, ['id'], [3]);
    expect(frag.sql).toBe('DELETE FROM "main"."users" WHERE "id" = ?');
    expect(frag.params).toEqual([3]);
  });

  it('guarded update appends a preimage predicate (IS) for each edited column', () => {
    const frag = sqliteBuildUpdateRowGuarded(
      { namespace: 'main', name: 'users' },
      [['name', 'B']],
      ['id'],
      [7],
      { kind: 'preimage', columns: ['name'], values: ['A'] },
    );
    expect(frag.sql).toBe('UPDATE "main"."users" SET "name" = ? WHERE "id" = ? AND "name" IS ? RETURNING *');
    expect(frag.params).toEqual(['B', 7, 'A']);
  });

  it('guarded update rejects a version-token guard (SQLite has no row version)', () => {
    expect(() =>
      sqliteBuildUpdateRowGuarded(
        { namespace: 'main', name: 'users' },
        [['name', 'B']],
        ['id'],
        [7],
        { kind: 'version', value: '1' },
      ),
    ).toThrow(/does not support version-token/i);
  });
});

describe('sqlite ddl builders', () => {
  it('creates a table with a table-level primary key', () => {
    const frag = sqliteBuildCreateTable({
      schema: 'main',
      table: 'widgets',
      columns: [
        { name: 'id', type: 'integer', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'text', nullable: true, isPrimaryKey: false },
      ],
    });
    expect(frag.sql).toContain('CREATE TABLE "main"."widgets"');
    expect(frag.sql).toContain('"id" integer NOT NULL');
    expect(frag.sql).toContain('PRIMARY KEY ("id")');
  });

  it('creates an index without a USING method (unsupported in SQLite)', () => {
    const frag = sqliteBuildCreateIndex(
      { schema: 'main', table: 'users', columns: ['email'], unique: true },
      'users_email_idx',
      'btree',
    );
    expect(frag.sql).toBe('CREATE UNIQUE INDEX "main"."users_email_idx" ON "users" ("email")');
    expect(frag.sql).not.toContain('USING');
  });

  it('drops a schema-qualified index', () => {
    const frag = sqliteBuildDropIndex({ namespace: 'main', name: 'users_email_idx' }, 'users_email_idx');
    expect(frag.sql).toBe('DROP INDEX "main"."users_email_idx"');
  });
});
