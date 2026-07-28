import { describe, expect, it } from 'vitest';
import { csvEscape, formatCsvRow } from './csv.js';

describe('csvEscape', () => {
  it('leaves a plain value unquoted', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(true)).toBe('true');
  });

  it('quotes and escapes values containing the delimiter, quotes, or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  it('keeps NULL distinct from empty string', () => {
    expect(csvEscape(null)).toBe(''); // empty, unquoted → NULL
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape('')).toBe('""'); // quoted empty → empty string
  });

  it('renders null with an explicit token when configured', () => {
    expect(csvEscape(null, { nullToken: '\\N' })).toBe('\\N');
    expect(csvEscape(null, { nullToken: 'NULL' })).toBe('NULL');
  });

  it('quotes a null token that itself needs quoting', () => {
    expect(csvEscape(null, { nullToken: 'a,b' })).toBe('"a,b"');
  });

  it('honours a custom delimiter when deciding to quote', () => {
    expect(csvEscape('a;b', { delimiter: ';' })).toBe('"a;b"');
    expect(csvEscape('a,b', { delimiter: ';' })).toBe('a,b'); // comma is not the delimiter here
  });

  it('JSON-stringifies object values', () => {
    expect(csvEscape({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('formatCsvRow', () => {
  it('joins escaped fields with the delimiter', () => {
    expect(formatCsvRow(['id', 'name', 'note'])).toBe('id,name,note');
    expect(formatCsvRow([1, 'a,b', null])).toBe('1,"a,b",');
  });

  it('uses a custom delimiter throughout', () => {
    expect(formatCsvRow(['a', 'b;c', 3], { delimiter: ';' })).toBe('a;"b;c";3');
  });
});
