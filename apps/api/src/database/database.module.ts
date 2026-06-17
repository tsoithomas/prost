import { Global, Module } from '@nestjs/common';
import { DB_DRIVERS } from './db-driver.interface';
import { DbDriverRegistry } from './db-driver.registry';
import { PoolManager } from './pool-manager.service';
import { PgDriver } from './drivers/pg/pg-driver';

@Global()
@Module({
  providers: [
    PgDriver,
    { provide: DB_DRIVERS, useFactory: (pg: PgDriver) => [pg], inject: [PgDriver] },
    DbDriverRegistry,
    PoolManager,
  ],
  exports: [PoolManager, DbDriverRegistry, PgDriver],
})
export class DatabaseModule {}
