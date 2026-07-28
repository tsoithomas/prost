import type { ErrorCode, ErrorEnvelope } from '@prost/shared-types';
import { useAuthStore } from '../stores/authStore';

export const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

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

/** Extracts a user-facing message from a caught error, falling back for non-`ApiError`s. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Like `apiErrorMessage`, but appends the correlation id so a failed write can be traced in server logs. */
export function apiErrorDetail(error: unknown, fallback: string): string {
  const message = apiErrorMessage(error, fallback);
  return error instanceof ApiError && error.correlationId ? `${message} (ref: ${error.correlationId})` : message;
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

/**
 * POSTs `body` and saves the (streamed) response as a file download. Auth is bearer-token only, so a
 * plain `<a href>` to a protected endpoint can't authenticate — we fetch with the header, read the
 * whole response as a blob (bounded by the server's export row budget), then click a temporary
 * object-URL anchor. On a non-2xx, parses the JSON error envelope into an `ApiError` (the error path
 * is small JSON, not a stream). The download filename comes from `Content-Disposition`, else `fallbackName`.
 */
export async function downloadFile(path: string, body: unknown, fallbackName: string): Promise<void> {
  const { token } = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

  if (response.status === 401) {
    useAuthStore.getState().clear();
    if (typeof window !== 'undefined') window.location.assign('/login');
  }

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as Partial<ErrorEnvelope> | null;
    throw new ApiError(
      response.status,
      envelope?.error ?? 'INTERNAL_ERROR',
      envelope?.message ?? response.statusText,
      envelope?.correlationId ?? '',
    );
  }

  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Extract a `filename="…"` from a `Content-Disposition` header, if present. */
function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match?.[1];
}
