import { describe, expect, it } from 'vitest';
import { buildPagedQuery, QUERY_PAGE_SIZE } from './paging';

describe('buildPagedQuery', () => {
  it('wraps the statement in a subquery with limit/offset bound as $n params', () => {
    const { sql, params } = buildPagedQuery('SELECT * FROM users');

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT $1 OFFSET $2');
    expect(params).toEqual([QUERY_PAGE_SIZE + 1, 0]);
  });

  it('requests one row beyond the page size to detect truncation', () => {
    const { params } = buildPagedQuery('SELECT * FROM users', 10);

    expect(params).toEqual([11, 0]);
  });

  it('binds a custom offset', () => {
    const { params } = buildPagedQuery('SELECT * FROM users', 50, 100);

    expect(params).toEqual([51, 100]);
  });

  it('strips a trailing semicolon before wrapping', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users;');

    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT $1 OFFSET $2');
  });

  it('never interpolates the limit/offset values into the SQL text', () => {
    const { sql } = buildPagedQuery('SELECT * FROM users', 12345, 6789);

    expect(sql).not.toContain('12345');
    expect(sql).not.toContain('6789');
  });
});
