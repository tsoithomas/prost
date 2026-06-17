import { ConfigService } from '@nestjs/config';
import { SqliteDriver } from './sqlite-driver';
import { runDriverContractTests } from '../../testing/driver-contract';

const config = { get: () => undefined } as unknown as ConfigService;

// Runs fully in-process against an in-memory database — no external server needed.
runDriverContractTests(() => new SqliteDriver(config), {
  host: '',
  port: 0,
  database: ':memory:',
  username: '',
  password: '',
  sslEnabled: false,
  sslRejectUnauthorized: true,
});
