import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Pool, type QueryResultRow } from 'pg';
import type { TestConnectionResult } from '@prost/shared-types';
import { CryptoService, type EncryptedPayload } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ConnectionParams {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}

export interface ParameterizedResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
}

const CONNECT_TIMEOUT_MS = 5000;
const MAX_POOL_SIZE = 5;

/**
 * Node's `net` module connects to both IPv4/IPv6 addresses for a host (Happy Eyeballs) and,
 * if both fail, throws an `AggregateError` whose top-level `message` is empty — the useful
 * text (e.g. "connect ECONNREFUSED 127.0.0.1:5432") is on the wrapped errors.
 */
function describeConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = Array.from(error.errors).find((e): e is Error => e instanceof Error && !!e.message);
    if (inner) {
      return inner.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const code = (error as { code?: string } | undefined)?.code;
  return code ? `Connection failed (${code})` : 'Connection failed';
}

/**
 * Single choke point for talking to user-configured target databases (architecture
 * principle #1). Every query against a target DB must go through `runParameterized`,
 * which always binds values as `$n` parameters — callers are responsible for quoting
 * any identifiers with `quoteIdent` before interpolating them into SQL text.
 */
@Injectable()
export class PgConnectionService {
  private readonly logger = new Logger(PgConnectionService.name);
  private readonly pools = new Map<string, Pool>();
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    config: ConfigService,
  ) {
    this.statementTimeoutMs = Number(config.get('QUERY_TIMEOUT_MS') ?? 30000);
  }

  async runParameterized<T extends QueryResultRow = QueryResultRow>(
    connectionId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<ParameterizedResult<T>> {
    const pool = await this.getPool(connectionId);
    const start = Date.now();
    try {
      const result = await pool.query<T>(sql, params);
      this.logger.log(
        `target query ok connectionId=${connectionId} durationMs=${Date.now() - start}`,
      );
      return { rows: result.rows, fields: result.fields, rowCount: result.rowCount, command: result.command };
    } catch (error) {
      this.logger.warn(
        `target query failed connectionId=${connectionId} durationMs=${Date.now() - start} error=${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw error;
    }
  }

  /** Opens a throwaway client (not pooled/cached) to validate credentials. Always closes it. */
  async testConnection(params: ConnectionParams): Promise<TestConnectionResult> {
    const client = new Client({
      host: params.host,
      port: params.port,
      database: params.database,
      user: params.username,
      password: params.password,
      ssl: params.sslEnabled ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: this.statementTimeoutMs,
    });

    try {
      await client.connect();
      const result = await client.query<{ server_version: string }>('SHOW server_version');
      return {
        ok: true,
        message: 'Connection successful',
        serverVersion: result.rows[0]?.server_version,
      };
    } catch (error) {
      return {
        ok: false,
        message: describeConnectionError(error),
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  /** Evicts and closes the cached pool for a connection (e.g. on delete/credential change). */
  async evictPool(connectionId: string): Promise<void> {
    const pool = this.pools.get(connectionId);
    if (!pool) {
      return;
    }
    this.pools.delete(connectionId);
    await pool.end().catch(() => undefined);
  }

  private async getPool(connectionId: string): Promise<Pool> {
    const cached = this.pools.get(connectionId);
    if (cached) {
      return cached;
    }

    const connection = await this.prisma.connection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    const password = this.crypto.decrypt(connection.encryptedCredentials as unknown as EncryptedPayload);

    const pool = new Pool({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password,
      ssl: connection.sslEnabled ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: this.statementTimeoutMs,
      max: MAX_POOL_SIZE,
    });

    pool.on('error', (error) => {
      this.logger.error(`target pool error connectionId=${connectionId} message=${error.message}`);
    });

    this.pools.set(connectionId, pool);
    return pool;
  }
}
