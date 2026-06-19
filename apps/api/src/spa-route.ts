// Top-level route prefixes owned by the API. When a built frontend bundle is served from the
// same origin (see serveSpa in main.ts), any GET path that is NOT one of these is treated as a
// client-side SPA route and falls back to index.html. Every top-level controller prefix must be
// listed here, or its routes get shadowed by the SPA fallback. Routes nested under an existing
// prefix (e.g. metadata/grid/query/history/ai/ddl all live under `connections`) are covered by
// that prefix and need no separate entry.
export const API_ROUTE_PREFIXES = [
  'auth',
  'connections',
  'preferences',
  'llm-endpoints',
  'snippets',
  'health',
  'database-engines',
];

/** True when `path` belongs to the API (and must not be served the SPA index.html). */
export function isApiRoute(path: string): boolean {
  const normalized = path.replace(/^\/+/, '');
  return API_ROUTE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}
