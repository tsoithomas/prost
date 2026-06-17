import type { ConnectionDto } from '@prost/shared-types';

type EndpointFields = Pick<ConnectionDto, 'engine' | 'host' | 'port' | 'database'>;

/** SQLite connections are a file path; everything else is a network endpoint. */
export function connectionEndpoint(c: EndpointFields): string {
  return c.engine === 'sqlite' ? c.database : `${c.host}:${c.port}`;
}

/** Longer form used in the status bar — `db@host:port`, or just the file path for SQLite. */
export function connectionLocation(c: EndpointFields): string {
  return c.engine === 'sqlite' ? c.database : `${c.database}@${c.host}:${c.port}`;
}
