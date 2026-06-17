import path from 'node:path';
import type { ConnectionDto } from '@prost/shared-types';
import type { ConnectionParams } from '../database/types';

/**
 * The app's own SQLite database, surfaced to every user as a permanent, read-only connection for
 * self-inspection. It is *virtual* — not a Prisma row — so it is inherently single, always-present,
 * and undeletable. Reads flow through the normal target-DB seam (PoolManager → SqliteDriver opened
 * `readonly`); the boundary holds because the handle never writes and never borrows Prisma.
 */
export const SYSTEM_CONNECTION_ID = '__app_db__';
export const SYSTEM_CONNECTION_NAME = 'Prost App Database';

export function isSystemConnectionId(id: string): boolean {
  return id === SYSTEM_CONNECTION_ID;
}

/**
 * Resolves the SQLite file path from `DATABASE_URL`. Prisma resolves a relative `file:` URL against
 * the schema directory (`apps/api/prisma/`); the API process runs from `apps/api`, so we resolve
 * relative to `<cwd>/prisma` to point at the exact same file Prisma uses.
 */
export function resolveAppDbFile(databaseUrl: string): string {
  const raw = databaseUrl.replace(/^file:/, '');
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), 'prisma', raw);
}

export function buildSystemConnectionDto(databaseUrl: string): ConnectionDto {
  const epoch = new Date(0).toISOString();
  return {
    id: SYSTEM_CONNECTION_ID,
    name: SYSTEM_CONNECTION_NAME,
    engine: 'sqlite',
    host: '',
    port: 0,
    database: resolveAppDbFile(databaseUrl),
    username: '',
    sslEnabled: false,
    sslRejectUnauthorized: true,
    capabilities: { hasSchemas: false, readOnly: true },
    createdAt: epoch,
    updatedAt: epoch,
  };
}

export function buildSystemConnectionParams(databaseUrl: string): ConnectionParams {
  return {
    host: '',
    port: 0,
    database: resolveAppDbFile(databaseUrl),
    username: '',
    password: '',
    sslEnabled: false,
    sslRejectUnauthorized: true,
    readOnly: true,
  };
}
