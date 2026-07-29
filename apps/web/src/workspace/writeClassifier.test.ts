import { describe, expect, it } from 'vitest';
import { isLikelyWrite } from './writeClassifier';

describe('isLikelyWrite', () => {
  it('flags DML/DDL statements', () => {
    for (const sql of ['INSERT INTO t VALUES (1)', 'update t set x=1', 'DELETE FROM t', 'DROP TABLE t', 'alter table t add c int', 'TRUNCATE t']) {
      expect(isLikelyWrite(sql)).toBe(true);
    }
  });

  it('does not flag reads', () => {
    for (const sql of ['SELECT * FROM t', '  select 1', 'WITH x AS (SELECT 1) SELECT * FROM x', 'EXPLAIN SELECT 1', 'SHOW TABLES']) {
      expect(isLikelyWrite(sql)).toBe(false);
    }
  });

  it('skips leading comments and whitespace', () => {
    expect(isLikelyWrite('-- a note\nDELETE FROM t')).toBe(true);
    expect(isLikelyWrite('/* block */\n  select 1')).toBe(false);
  });
});
