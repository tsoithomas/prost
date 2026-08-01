import { describe, expect, it } from 'vitest';
import { rowToJson, rowsToTsv } from './clipboard';

describe('rowsToTsv', () => {
  it('renders a header row followed by tab-separated values', () => {
    const rows = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
    ];
    expect(rowsToTsv(rows, ['id', 'name'])).toBe('id\tname\n1\tAda\n2\tGrace');
  });

  it('renders a missing value as an empty cell, not "undefined"', () => {
    expect(rowsToTsv([{ id: 1 }], ['id', 'name'])).toBe('id\tname\n1\t');
  });

  it('renders null as an empty cell', () => {
    expect(rowsToTsv([{ id: 1, name: null }], ['id', 'name'])).toBe('id\tname\n1\t');
  });
});

describe('rowToJson', () => {
  it('pretty-prints only the given columns', () => {
    const row = { id: 1, name: 'Ada', secret: 'hide me' };
    const json = rowToJson(row, ['id', 'name']);
    expect(JSON.parse(json)).toEqual({ id: 1, name: 'Ada' });
    expect(json).not.toContain('secret');
  });
});
