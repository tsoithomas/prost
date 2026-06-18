import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { useDdlPreview } from './ddlPreview';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));

describe('useDdlPreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces requests and clears SQL when the body becomes null', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ sql: 'SELECT 1' });
    const body = { kind: 'createTable', request: { schema: 'public' } };
    const { result, rerender } = renderHook(
      ({ request }) => useDdlPreview('conn-1', request),
      { initialProps: { request: body as object | null } },
    );

    expect(apiFetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(300));
    expect(result.current.sql).toBe('SELECT 1');
    expect(apiFetch).toHaveBeenCalledWith('/connections/conn-1/ddl/preview', expect.objectContaining({
      method: 'POST',
      body,
      signal: expect.any(AbortSignal),
    }));

    act(() => rerender({ request: null }));
    expect(result.current).toEqual({ sql: null, error: null });
  });

  it('ignores an aborted superseded response', async () => {
    let resolveFirst: ((value: { sql: string }) => void) | undefined;
    vi.mocked(apiFetch)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ sql: 'new SQL' });

    const { result, rerender } = renderHook(
      ({ request }) => useDdlPreview('conn-1', request),
      { initialProps: { request: { value: 'old' } as object | null } },
    );
    await act(async () => vi.advanceTimersByTime(300));
    rerender({ request: { value: 'new' } });
    await act(async () => vi.advanceTimersByTime(300));
    expect(result.current.sql).toBe('new SQL');

    await act(async () => resolveFirst?.({ sql: 'old SQL' }));
    expect(result.current.sql).toBe('new SQL');
  });
});
