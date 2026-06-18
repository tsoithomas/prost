import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RowEditEntry } from './useEditBuffer';
import { buildRowEdit, useEditBuffer } from './useEditBuffer';

const ENTRY: RowEditEntry = {
  primaryKey: { id: 1 },
  version: '42',
  original: { email: 'old@x.com' },
  edits: { email: 'new@x.com' },
};

describe('buildRowEdit', () => {
  it('token mode sends the version and no expected', () => {
    expect(buildRowEdit(ENTRY, 'token')).toEqual({
      primaryKey: { id: 1 },
      edits: [{ column: 'email', value: 'new@x.com' }],
      version: '42',
    });
  });

  it('preimage mode sends original values of the edited columns and no version', () => {
    expect(buildRowEdit(ENTRY, 'preimage')).toEqual({
      primaryKey: { id: 1 },
      edits: [{ column: 'email', value: 'new@x.com' }],
      expected: { email: 'old@x.com' },
    });
  });
});

describe('useEditBuffer', () => {
  const identity = (id: number, version?: string) => ({ primaryKey: { id }, version });

  it('stages edits across rows and builds a body with the right guard per concurrency', () => {
    const { result } = renderHook(() => useEditBuffer());

    act(() => {
      result.current.stage('1', identity(1, 'v1'), 'email', 'a@x.com', 'A@x.com');
      result.current.stage('2', identity(2, 'v2'), 'email', 'b@x.com', 'B@x.com');
    });

    expect(result.current.dirtyCells).toBe(2);
    expect(result.current.buildBody('token')).toEqual({
      rows: [
        { primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'A@x.com' }], version: 'v1' },
        { primaryKey: { id: 2 }, edits: [{ column: 'email', value: 'B@x.com' }], version: 'v2' },
      ],
    });
    expect(result.current.buildBody('preimage')).toEqual({
      rows: [
        { primaryKey: { id: 1 }, edits: [{ column: 'email', value: 'A@x.com' }], expected: { email: 'a@x.com' } },
        { primaryKey: { id: 2 }, edits: [{ column: 'email', value: 'B@x.com' }], expected: { email: 'b@x.com' } },
      ],
    });
  });

  it('drops an edit that returns a cell to its original value (and removes the now-empty row)', () => {
    const { result } = renderHook(() => useEditBuffer());

    act(() => {
      result.current.stage('1', identity(1), 'email', 'a@x.com', 'changed');
    });
    expect(result.current.dirtyCells).toBe(1);

    act(() => {
      result.current.stage('1', identity(1), 'email', 'a@x.com', 'a@x.com');
    });
    expect(result.current.dirtyCells).toBe(0);
    expect(result.current.buildBody('token').rows).toHaveLength(0);
  });

  it('clear() empties the buffer', () => {
    const { result } = renderHook(() => useEditBuffer());
    act(() => result.current.stage('1', identity(1), 'email', 'a', 'b'));
    act(() => result.current.clear());
    expect(result.current.dirtyCells).toBe(0);
  });
});
