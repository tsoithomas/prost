import { describe, expect, it } from 'vitest';
import { splitStatementRanges, statementAtOffset } from './statementRanges';

describe('splitStatementRanges', () => {
  it('splits multiple statements and reports offsets into the original string', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    const ranges = splitStatementRanges(sql);
    expect(ranges.map((r) => r.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(sql.slice(ranges[0]!.start, ranges[0]!.end)).toBe('SELECT 1');
    expect(sql.slice(ranges[1]!.start, ranges[1]!.end)).toBe('SELECT 2');
  });

  it('handles a single statement with no trailing semicolon', () => {
    expect(splitStatementRanges('SELECT * FROM users').map((r) => r.sql)).toEqual([
      'SELECT * FROM users',
    ]);
  });

  it('drops empty/whitespace-only segments', () => {
    expect(splitStatementRanges('SELECT 1;;\n  \n;SELECT 2;').map((r) => r.sql)).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('does not split on semicolons inside strings', () => {
    expect(splitStatementRanges("SELECT ';not a split';").map((r) => r.sql)).toEqual([
      "SELECT ';not a split'",
    ]);
  });

  it('does not split on semicolons inside block comments or dollar-quotes', () => {
    const sql = '/* block ; comment */ SELECT 1;\nSELECT $$ body ; semis $$;';
    expect(splitStatementRanges(sql).map((r) => r.sql)).toEqual([
      '/* block ; comment */ SELECT 1',
      'SELECT $$ body ; semis $$',
    ]);
  });

  it('does not split on semicolons inside a line comment (comment stays with its statement)', () => {
    expect(splitStatementRanges('-- lead ; comment\nSELECT 1;').map((r) => r.sql)).toEqual([
      '-- lead ; comment\nSELECT 1',
    ]);
  });
});

describe('statementAtOffset', () => {
  const sql = 'SELECT 1;\nSELECT 2;\n';

  it('returns the statement containing the cursor (first statement)', () => {
    expect(statementAtOffset(sql, 3)).toBe('SELECT 1');
  });

  it('returns the statement containing the cursor (second statement)', () => {
    expect(statementAtOffset(sql, sql.indexOf('SELECT 2') + 2)).toBe('SELECT 2');
  });

  it('falls back to the nearest preceding statement on a trailing blank line', () => {
    expect(statementAtOffset(sql, sql.length)).toBe('SELECT 2');
  });

  it('falls back to the first statement when the cursor is before it', () => {
    expect(statementAtOffset('   \nSELECT 1;', 0)).toBe('SELECT 1');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(statementAtOffset('   \n  \n', 2)).toBeNull();
  });
});
