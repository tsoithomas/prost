import { ConfigService } from '@nestjs/config';
import { PgDriver } from './pg-driver';
import { runDriverContractTests } from '../../testing/driver-contract';

const config = { get: (k: string) => ({ QUERY_TIMEOUT_MS: '30000', TARGET_POOL_SIZE: '5' } as Record<string, string>)[k] } as unknown as ConfigService;

runDriverContractTests(() => new PgDriver(config), {
  host: process.env.CONTRACT_PG_HOST ?? 'localhost',
  port: Number(process.env.CONTRACT_PG_PORT ?? 5434),
  database: process.env.CONTRACT_PG_DB ?? 'demo',
  username: process.env.CONTRACT_PG_USER ?? 'demo',
  password: process.env.CONTRACT_PG_PASSWORD ?? 'demo',
  sslEnabled: false,
  sslRejectUnauthorized: true,
});
