import { describe, expect, it } from 'vitest';
import { splitStatements } from './statement-splitter';

describe('splitStatements', () => {
  it('splits on top-level semicolons', () => {
    expect(splitStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('drops a trailing semicolon', () => {
    expect(splitStatements('SELECT 1;')).toEqual(['SELECT 1']);
  });

  it('does not split on a semicolon inside a single-quoted string', () => {
    expect(splitStatements("SELECT ';'; SELECT 2")).toEqual(["SELECT ';'", 'SELECT 2']);
  });

  it('handles doubled single-quote escapes inside a string', () => {
    expect(splitStatements("SELECT 'it''s'; SELECT 2")).toEqual(["SELECT 'it''s'", 'SELECT 2']);
  });

  it('does not split on a semicolon inside a double-quoted identifier', () => {
    expect(splitStatements('SELECT "a;b" FROM t; SELECT 2')).toEqual(['SELECT "a;b" FROM t', 'SELECT 2']);
  });

  it('does not split on a semicolon inside a $$-quoted body', () => {
    expect(splitStatements('SELECT $$a;b$$; SELECT 2')).toEqual(['SELECT $$a;b$$', 'SELECT 2']);
  });

  it('does not split on a semicolon inside a tagged dollar-quoted body', () => {
    expect(splitStatements('SELECT $tag$a;b$tag$; SELECT 2')).toEqual(['SELECT $tag$a;b$tag$', 'SELECT 2']);
  });

  it('does not split on a semicolon inside a line comment', () => {
    expect(splitStatements('SELECT 1; -- comment with ; inside\nSELECT 2')).toEqual(['SELECT 1', '-- comment with ; inside\nSELECT 2']);
  });

  it('does not split on a semicolon inside a block comment', () => {
    expect(splitStatements('SELECT 1; /* block ; comment */ SELECT 2')).toEqual(['SELECT 1', '/* block ; comment */ SELECT 2']);
  });

  it('handles nested block comments', () => {
    expect(splitStatements('/* outer /* inner ; */ still outer */ SELECT 1')).toEqual(['/* outer /* inner ; */ still outer */ SELECT 1']);
  });

  it('drops empty segments from stray/extra semicolons and whitespace', () => {
    expect(splitStatements('   ;;; SELECT 1 ;;  ')).toEqual(['SELECT 1']);
  });

  it('does not treat $1/$2 positional parameters as dollar-quote delimiters', () => {
    expect(splitStatements('SELECT $1, $2 FROM t WHERE id = $1')).toEqual(['SELECT $1, $2 FROM t WHERE id = $1']);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('   \n  ')).toEqual([]);
  });
});
