export type ParsedEngine = 'postgres' | 'mysql';

export interface ParsedConnectionString {
  engine: ParsedEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  sslRejectUnauthorized: boolean;
}

export type ParseConnectionStringResult =
  | { ok: true; value: ParsedConnectionString }
  | { ok: false; error: string };

// `require`/`verify-ca`/`verify-full`/`prefer`, an unrecognized value, and a missing
// `sslmode` all map to `true` — only an explicit disable/allow turns SSL off.
const SSL_DISABLED_MODES = new Set(['disable', 'allow']);

// Only `verify-ca`/`verify-full` ask libpq to validate the server certificate; `require`,
// `prefer`, and a missing `sslmode` encrypt without verifying.
const SSL_VERIFIED_MODES = new Set(['verify-ca', 'verify-full']);

function getCaseInsensitiveQueryParam(searchParams: URLSearchParams, name: string): string | null {
  const normalizedName = name.toLowerCase();
  let match: string | null = null;
  searchParams.forEach((value, key) => {
    if (match === null && key.toLowerCase() === normalizedName) match = value;
  });
  return match;
}

/**
 * Parses a Postgres or MySQL connection URI into the fields used by
 * `ConnectionFormState`. Never throws — invalid input produces `{ ok: false, error }`
 * with a message suitable for display to the user.
 */
export function parseConnectionString(input: string): ParseConnectionStringResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter a connection string to parse.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Could not parse connection string.' };
  }

  const engine: ParsedEngine | null =
    url.protocol === 'postgres:' || url.protocol === 'postgresql:'
      ? 'postgres'
      : url.protocol === 'mysql:'
        ? 'mysql'
        : null;

  if (!engine) {
    return {
      ok: false,
      error: 'Connection string must start with postgres://, postgresql://, or mysql://',
    };
  }

  if (!url.hostname) {
    return { ok: false, error: 'Connection string is missing a host.' };
  }

  let sslEnabled: boolean;
  let sslRejectUnauthorized: boolean;

  if (engine === 'mysql') {
    const sslMode = getCaseInsensitiveQueryParam(url.searchParams, 'ssl-mode')?.toUpperCase();
    sslEnabled = sslMode !== 'DISABLED';
    sslRejectUnauthorized = sslMode === 'VERIFY_CA' || sslMode === 'VERIFY_IDENTITY';
  } else {
    const sslmode = url.searchParams.get('sslmode');
    sslEnabled = !SSL_DISABLED_MODES.has(sslmode ?? '');
    sslRejectUnauthorized = SSL_VERIFIED_MODES.has(sslmode ?? '');
  }

  return {
    ok: true,
    value: {
      engine,
      host: url.hostname,
      port: url.port ? Number(url.port) : engine === 'mysql' ? 3306 : 5432,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      sslEnabled,
      sslRejectUnauthorized,
    },
  };
}
