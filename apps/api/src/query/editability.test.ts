import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';
import { analyzeEditability, extractSingleTable, type ParsedStatement } from './editability';

const parser = new Parser();

function parse(sql: string): ParsedStatement[] {
  const ast = parser.astify(sql, { database: 'postgresql' });
  return (Array.isArray(ast) ? ast : [ast]) as ParsedStatement[];
}

const USERS_PK = ['id'];

describe('extractSingleTable', () => {
  it('resolves a plain single-table SELECT', () => {
    expect(extractSingleTable(parse('SELECT * FROM users'))).toEqual({ schema: 'public', table: 'users' });
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
