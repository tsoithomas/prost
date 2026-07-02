import { describe, expect, it } from 'vitest';
import { buildOrderedStatement, buildPagedQuery, looksLikeSingleSelect, QUERY_PAGE_SIZE } from './paging';

const dq = (id: string) => `"${id}"`;

describe('buildPagedQuery', () => {
  it('wraps the statement in a subquery with limit/offset bound as $n params', () => {
    const { sql, params } = buildPagedQuery('SELECT * FROM users');

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT $1 OFFSET $2');
    expect(params).toEqual([QUERY_PAGE_SIZE + 1, 0]);
  });

  it('requests one row beyond the page size to detect truncation', () => {
    const { params } = buildPagedQuery('SELECT * FROM users', undefined, 10);

    expect(params).toEqual([11, 0]);
  });

  it('binds a custom offset', () => {
    const { params } = buildPagedQuery('SELECT * FROM users', undefined, 50, 100);

    expect(params).toEqual([51, 100]);
  });

  it('uses the supplied placeholder for limit/offset (e.g. SQLite ?)', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users', () => '?');

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT ? OFFSET ?');
  });

  it('strips a trailing semicolon before wrapping', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users;');

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT $1 OFFSET $2');
  });

  it('never interpolates the limit/offset values into the SQL text', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users', undefined, 12345, 6789);

    expect(sql).not.toContain('12345');
    expect(sql).not.toContain('6789');
  });

  it('appends a quoted ORDER BY before the LIMIT/OFFSET when sorting descending', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users', undefined, 100, 0, {
      column: 'name',
      dir: 'desc',
      quoteIdent: dq,
    });

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query ORDER BY "name" DESC LIMIT $1 OFFSET $2');
  });

  it('defaults the sort direction keyword to ASC', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users', undefined, 100, 0, {
      column: 'id',
      dir: 'asc',
      quoteIdent: dq,
    });

    expect(sql).toContain('ORDER BY "id" ASC');
  });
});

describe('buildOrderedStatement', () => {
  it('wraps a SELECT in an ORDER BY-only subquery (no LIMIT) for the cursor path', () => {
    const sql = buildOrderedStatement('SELECT * FROM users;', { column: 'created_at', dir: 'desc', quoteIdent: dq });

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query ORDER BY "created_at" DESC');
    expect(sql).not.toContain('LIMIT');
  });
});

describe('looksLikeSingleSelect', () => {
  it('accepts a plain SELECT', () => {
    expect(looksLikeSingleSelect('SELECT * FROM users')).toBe(true);
  });

  it('accepts a SELECT with leading whitespace and mixed case', () => {
    expect(looksLikeSingleSelect('  Select * from users')).toBe(true);
  });

  it('accepts a SELECT with a single trailing semicolon', () => {
    expect(looksLikeSingleSelect('SELECT * FROM users;')).toBe(true);
  });

  it('rejects a non-SELECT statement', () => {
    expect(looksLikeSingleSelect('UPDATE users SET email = $1')).toBe(false);
  });

  it('rejects a SELECT followed by another statement', () => {
    expect(looksLikeSingleSelect('SELECT * FROM users; DROP TABLE users;')).toBe(false);
  });

  it('rejects a misspelled keyword', () => {
    expect(looksLikeSingleSelect('SELEKT * FROM users')).toBe(false);
  });
});
