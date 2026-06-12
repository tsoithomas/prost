import type { ErrorCode, ErrorEnvelope } from '@prost/shared-types';
import { useAuthStore } from '../stores/authStore';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly correlationId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Fetch wrapper for the Nest API: injects the bearer token, parses the
 * `{ error, message, correlationId }` envelope from `AllExceptionsFilter` into
 * a typed `ApiError`, and on 401 clears auth + redirects to `/login`.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token } = useAuthStore.getState();

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (response.status === 401) {
    useAuthStore.getState().clear();
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = data as Partial<ErrorEnvelope> | null;
    throw new ApiError(
      response.status,
      envelope?.error ?? 'INTERNAL_ERROR',
      envelope?.message ?? response.statusText,
      envelope?.correlationId ?? '',
    );
  }

  return data as T;
}
