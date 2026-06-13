export interface ParsedConnectionString {
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

/**
 * Parses a `postgres://`/`postgresql://` connection URI into the fields used by
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

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { ok: false, error: 'Connection string must start with postgres:// or postgresql://' };
  }

  if (!url.hostname) {
    return { ok: false, error: 'Connection string is missing a host.' };
  }

  const sslmode = url.searchParams.get('sslmode');
  const sslEnabled = !SSL_DISABLED_MODES.has(sslmode ?? '');
  const sslRejectUnauthorized = SSL_VERIFIED_MODES.has(sslmode ?? '');

  return {
    ok: true,
    value: {
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      sslEnabled,
      sslRejectUnauthorized,
    },
  };
}
