import { describe, expect, it } from 'vitest';
import { MASK_TOKEN, type MaskedColumns } from '@prost/shared-types';
import { maskedColumnsFor, redactRows, tableKey } from './masking';

const PREFS: MaskedColumns = {
  'conn-1': {
    'public.users': ['email', 'phone'],
    'public.orders': ['card_number'],
  },
  'conn-2': {
    'public.users': ['ssn'],
  },
};

describe('maskedColumnsFor', () => {
  it('resolves the columns masked for one table on one connection', () => {
    expect(maskedColumnsFor(PREFS, 'conn-1', 'public', 'users')).toEqual(new Set(['email', 'phone']));
    expect(maskedColumnsFor(PREFS, 'conn-1', 'public', 'orders')).toEqual(new Set(['card_number']));
  });

  it('scopes by connection — the same table is masked differently elsewhere', () => {
    expect(maskedColumnsFor(PREFS, 'conn-2', 'public', 'users')).toEqual(new Set(['ssn']));
  });

  it('returns an empty set for unknown connections, tables, and an absent preference', () => {
    expect(maskedColumnsFor(PREFS, 'conn-9', 'public', 'users').size).toBe(0);
    expect(maskedColumnsFor(PREFS, 'conn-1', 'public', 'products').size).toBe(0);
    expect(maskedColumnsFor(PREFS, 'conn-1', 'other', 'users').size).toBe(0);
    expect(maskedColumnsFor(undefined, 'conn-1', 'public', 'users').size).toBe(0);
  });
});

describe('redactRows', () => {
  const rows = [
    { id: 1, email: 'a@x.com', phone: '555', name: 'Ann' },
    { id: 2, email: null, phone: '556', name: 'Bo' },
  ];

  it('replaces masked values with the token and leaves other columns intact', () => {
    const out = redactRows(rows, new Set(['email', 'phone']));
    expect(out[0]).toEqual({ id: 1, email: MASK_TOKEN, phone: MASK_TOKEN, name: 'Ann' });
    expect(out[1]!.name).toBe('Bo');
    expect(out[1]!.id).toBe(2);
  });

  it('leaves NULL as null — a mask must not invent a value that is not there', () => {
    const out = redactRows(rows, new Set(['email']));
    expect(out[1]!.email).toBeNull();
  });

  it('never mutates the input rows', () => {
    redactRows(rows, new Set(['email']));
    expect(rows[0]!.email).toBe('a@x.com');
  });

  it('is a no-op when nothing is masked', () => {
    expect(redactRows(rows, new Set())).toBe(rows);
  });

  it('ignores masked columns the projection does not include', () => {
    const out = redactRows([{ id: 1 }], new Set(['email']));
    expect(out[0]).toEqual({ id: 1 });
    expect('email' in out[0]!).toBe(false);
  });
});

describe('tableKey', () => {
  it('matches the "schema.table" preference key shape', () => {
    expect(tableKey('public', 'users')).toBe('public.users');
  });
});

describe('maskedColumnsFor — primary keys are never masked', () => {
  const PK_PREFS: MaskedColumns = { 'conn-1': { 'public.users': ['id', 'email'] } };

  it('drops a masked PK column but keeps the rest', () => {
    // Redacting a PK would give every row the same grid identity and point every
    // update/delete at a row that does not exist — masking must not break row targeting.
    expect(maskedColumnsFor(PK_PREFS, 'conn-1', 'public', 'users', ['id'])).toEqual(new Set(['email']));
  });

  it('drops every component of a composite key', () => {
    const prefs: MaskedColumns = { 'conn-1': { 'public.order_items': ['order_id', 'line', 'note'] } };
    expect(maskedColumnsFor(prefs, 'conn-1', 'public', 'order_items', ['order_id', 'line'])).toEqual(
      new Set(['note']),
    );
  });

  it('masks nothing when the only marked column is the PK', () => {
    expect(maskedColumnsFor({ 'conn-1': { 'public.users': ['id'] } }, 'conn-1', 'public', 'users', ['id']).size).toBe(0);
  });

  it('is a no-op for a table with no primary key', () => {
    // Such tables are not editable and AG Grid indexes rows itself, so masking is safe there.
    expect(maskedColumnsFor(PK_PREFS, 'conn-1', 'public', 'users', [])).toEqual(new Set(['id', 'email']));
  });
});
