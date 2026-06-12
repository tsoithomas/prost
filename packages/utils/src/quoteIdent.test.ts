import { describe, expect, it } from 'vitest';
import { quoteIdent } from './quoteIdent.js';

describe('quoteIdent', () => {
  it.each([
    ['users', '"users"'],
    ['first_name', '"first_name"'],
    ['Users', '"Users"'],
    ['order', '"order"'],
    ['my table', '"my table"'],
    ['weird"name', '"weird""name"'],
    ['""', '""""""'],
  ])('quotes %j as %j', (input, expected) => {
    expect(quoteIdent(input)).toBe(expected);
  });

  it('rejects an empty identifier', () => {
    expect(() => quoteIdent('')).toThrow('Identifier must not be empty');
  });

  it('rejects an identifier containing a null byte', () => {
    expect(() => quoteIdent('us\u0000ers')).toThrow('Identifier must not contain null bytes');
  });
});
