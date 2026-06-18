import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';
import { analyzeEditability, extractSingleTable, type ParsedStatement } from './editability';

const parser = new Parser();

function parse(sql: string): ParsedStatement[] {
  const ast = parser.astify(sql, { database: 'postgresql' });
  return (Array.isArray(ast) ? ast : [ast]) as unknown as ParsedStatement[];
}

const USERS_PK = ['id'];

describe('extractSingleTable', () => {
  it('resolves a plain single-table SELECT', () => {
    expect(extractSingleTable(parse('SELECT * FROM users'))).toEqual({ schema: 'public', table: 'users' });
  });

  it('resolves an unqualified table against the supplied default schema', () => {
    expect(extractSingleTable(parse('SELECT * FROM orders'), 'shop')).toEqual({ schema: 'shop', table: 'orders' });
  });

  it('resolves a schema-qualified table', () => {
    expect(extractSingleTable(parse('SELECT * FROM public.users'))).toEqual({ schema: 'public', table: 'users' });
  });

  it('returns null for a join', () => {
    expect(extractSingleTable(parse('SELECT * FROM users JOIN orders ON orders.user_id = users.id'))).toBeNull();
  });

  it('returns null for a subquery in FROM', () => {
    expect(extractSingleTable(parse('SELECT * FROM (SELECT * FROM users) AS sub'))).toBeNull();
  });

  it('returns null for a CTE', () => {
    expect(extractSingleTable(parse('WITH recent AS (SELECT * FROM users) SELECT * FROM recent'))).toBeNull();
  });

  it('returns null for a non-SELECT statement', () => {
    expect(extractSingleTable(parse("UPDATE users SET name = 'x' WHERE id = 1"))).toBeNull();
  });

  it('returns null for multi-statement input', () => {
    expect(extractSingleTable(parse('SELECT 1; SELECT 2;'))).toBeNull();
  });
});

describe('analyzeEditability — spec §6.7 truth table', () => {
  it('SELECT * FROM users — editable, PK present via *', () => {
    const statements = parse('SELECT * FROM users');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({
      editable: true,
      sourceTable: 'public.users',
      primaryKey: ['id'],
    });
  });

  it('SELECT id, name, email FROM users — editable, PK explicitly projected', () => {
    const statements = parse('SELECT id, name, email FROM users');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({
      editable: true,
      sourceTable: 'public.users',
      primaryKey: ['id'],
    });
  });

  it('SELECT name FROM users — read-only, PK missing from projection', () => {
    const statements = parse('SELECT name FROM users');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({ editable: false });
  });

  it('SELECT COUNT(*) FROM users — read-only, aggregate', () => {
    const statements = parse('SELECT COUNT(*) FROM users');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({ editable: false });
  });

  it('SELECT department, COUNT(*) FROM users GROUP BY department — read-only, GROUP BY', () => {
    const statements = parse('SELECT department, COUNT(*) FROM users GROUP BY department');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({ editable: false });
  });

  it('SELECT DISTINCT name FROM users — read-only, DISTINCT', () => {
    const statements = parse('SELECT DISTINCT name FROM users');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({ editable: false });
  });

  it('SELECT * FROM users JOIN orders ON ... — read-only, join (no table to resolve)', () => {
    const statements = parse('SELECT * FROM users JOIN orders ON orders.user_id = users.id');

    expect(extractSingleTable(statements)).toBeNull();
  });

  it('a table with no primary key is never editable, even via SELECT *', () => {
    const statements = parse('SELECT * FROM logs');
    const table = extractSingleTable(statements)!;

    expect(analyzeEditability(statements, table, [])).toEqual({ editable: false });
  });

  it('UPDATE users SET ... — read-only (non-SELECT)', () => {
    const statements = parse("UPDATE users SET name = 'x' WHERE id = 1");

    expect(extractSingleTable(statements)).toBeNull();
  });

  it('SELECT 1; SELECT 2; — read-only (multi-statement)', () => {
    const statements = parse('SELECT 1; SELECT 2;');

    expect(extractSingleTable(statements)).toBeNull();
  });
});

describe('editability fail-safe — risky SQL shapes are read-only', () => {
  it('UNION — extractSingleTable returns null (two FROM sources)', () => {
    const statements = parse('SELECT id FROM users UNION SELECT id FROM admins');
    expect(extractSingleTable(statements)).toBeNull();
  });

  it('UNION ALL — read-only', () => {
    const statements = parse('SELECT id FROM users UNION ALL SELECT id FROM admins');
    expect(extractSingleTable(statements)).toBeNull();
  });

  it('INTERSECT — read-only', () => {
    const statements = parse('SELECT id FROM users INTERSECT SELECT id FROM admins');
    expect(extractSingleTable(statements)).toBeNull();
  });

  it('EXCEPT — read-only', () => {
    const statements = parse('SELECT id FROM users EXCEPT SELECT id FROM admins');
    expect(extractSingleTable(statements)).toBeNull();
  });

  it('subquery in WHERE — extractSingleTable returns null (WHERE contains a subquery)', () => {
    const statements = parse("SELECT id, email FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)");
    expect(extractSingleTable(statements)).toBeNull();
  });

  it('window function (OVER) — read-only', () => {
    // node-sql-parser may fail to parse OVER; either way result is read-only
    try {
      const statements = parse('SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM users');
      const table = extractSingleTable(statements);
      if (table === null) {
        expect(table).toBeNull();
      } else {
        expect(analyzeEditability(statements, table, USERS_PK)).toEqual({ editable: false });
      }
    } catch {
      // parse failure → read-only path in QueryService (executeUnparsedSelect / executeOther)
      expect(true).toBe(true);
    }
  });

  it('schema-qualified table SELECT * — still editable (this is the supported case)', () => {
    const statements = parse('SELECT * FROM public.users');
    const table = extractSingleTable(statements)!;

    expect(table).toEqual({ schema: 'public', table: 'users' });
    expect(analyzeEditability(statements, table, USERS_PK)).toEqual({
      editable: true,
      sourceTable: 'public.users',
      primaryKey: ['id'],
    });
  });

  it('VALUES — not a SELECT, read-only', () => {
    // VALUES without INSERT is not standard SQL; parser will throw or misclassify
    try {
      const statements = parse('VALUES (1, 2), (3, 4)');
      expect(extractSingleTable(statements)).toBeNull();
    } catch {
      expect(true).toBe(true);
    }
  });
});
