import { ConfigService } from '@nestjs/config';
import { MysqlDriver } from './mysql-driver';
import { runDriverContractTests } from '../../testing/driver-contract';

const config = { get: (k: string) => ({ QUERY_TIMEOUT_MS: '30000', TARGET_POOL_SIZE: '5' } as Record<string, string>)[k] } as unknown as ConfigService;

// Matches docker-compose's demo-target-mysql: host port 3307, demo/demo/demo. The suite
// creates its own table(s), so the init SQL isn't required; without a live server it skips
// itself (unless REQUIRE_LIVE_DRIVER_CONTRACTS=true, e.g. in CI, where it fails instead).
runDriverContractTests(() => new MysqlDriver(config), {
  host: process.env.CONTRACT_MYSQL_HOST ?? 'localhost',
  port: Number(process.env.CONTRACT_MYSQL_PORT ?? 3307),
  database: process.env.CONTRACT_MYSQL_DB ?? 'demo',
  username: process.env.CONTRACT_MYSQL_USER ?? 'demo',
  password: process.env.CONTRACT_MYSQL_PASSWORD ?? 'demo',
  sslEnabled: false,
  sslRejectUnauthorized: true,
});
