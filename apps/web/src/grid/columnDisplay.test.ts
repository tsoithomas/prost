import { describe, expect, it } from 'vitest';
import { formatBooleanDisplay, formatDateDisplay, formatNull } from './columnDefs';

describe('formatNull', () => {
  it('maps each preset (default is the literal null)', () => {
    expect(formatNull(undefined)).toBe('null');
    expect(formatNull('parens')).toBe('(null)');
    expect(formatNull('blank')).toBe('');
    expect(formatNull('upper')).toBe('NULL');
    expect(formatNull('symbol')).toBe('␀');
  });
});

describe('formatBooleanDisplay', () => {
  it('renders truthy/falsey per preset', () => {
    expect(formatBooleanDisplay(true, 'truefalse')).toBe('true');
    expect(formatBooleanDisplay(false, 'truefalse')).toBe('false');
    expect(formatBooleanDisplay('t', 'check')).toBe('✓');
    expect(formatBooleanDisplay(0, 'check')).toBe('✗');
    expect(formatBooleanDisplay(1, 'onezero')).toBe('1');
    expect(formatBooleanDisplay('false', 'onezero')).toBe('0');
  });
});

describe('formatDateDisplay', () => {
  it('renders ISO 8601 with the selected zone offset', () => {
    expect(formatDateDisplay('2024-01-02T03:04:05Z', 'iso', 'UTC')).toBe('2024-01-02T03:04:05+00:00');
    // 03:04 UTC is 22:04 the previous day in US Eastern (UTC-5 in January).
    expect(formatDateDisplay('2024-01-02T03:04:05Z', 'iso', 'America/New_York')).toBe('2024-01-01T22:04:05-05:00');
  });
  it('renders FRIENDLY as a readable string honoring the time zone', () => {
    expect(formatDateDisplay('2024-01-02T03:04:05Z', 'friendly', 'America/New_York')).toContain('2024');
    expect(formatDateDisplay('2024-01-02T03:04:05Z', 'friendly', 'UTC')).not.toBe(
      formatDateDisplay('2024-01-02T03:04:05Z', 'friendly', 'Asia/Tokyo'),
    );
  });
  it('leaves an unparseable value as-is', () => {
    expect(formatDateDisplay('not-a-date', 'friendly')).toBe('not-a-date');
  });
});
