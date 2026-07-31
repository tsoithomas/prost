import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useUpdatePreferences } from './preferences';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../lib/apiClient', () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));

let client: QueryClient;
/** Spy on the real client's invalidation, so the assertion is about behavior, not a mock's shape. */
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(client, 'invalidateQueries');
  mockApiFetch.mockResolvedValue({});
});

describe('useUpdatePreferences — masking invalidates open grids (Phase 39)', () => {
  it('invalidates the grid read after a masking change is persisted', async () => {
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    result.current.mutate({ maskedColumns: { 'conn-1': { 'public.users': ['email'] } } });

    // Masking is applied server-side, so the grid has to re-read — whoever changed it.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['grid-columns'] }));
  });

  it('invalidates when masking is cleared from the settings roster', async () => {
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    result.current.mutate({ maskedColumns: {} });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['grid-columns'] }));
  });

  it('only invalidates after the write lands, never on the optimistic store update', async () => {
    let resolveWrite: (value: unknown) => void = () => {};
    mockApiFetch.mockReturnValue(new Promise((resolve) => { resolveWrite = resolve; }));
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    result.current.mutate({ maskedColumns: {} });
    // While the PATCH is in flight a refetch would read the *old* preference back.
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();

    resolveWrite({});
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['grid-columns'] }));
  });

  it('leaves grids alone for unrelated preference changes', async () => {
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    result.current.mutate({ fontSize: 'lg' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
