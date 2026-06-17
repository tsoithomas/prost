import { Global, Module } from '@nestjs/common';
import { PgConnectionService } from '../target-db/pg-connection.service';
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
    // Temporary: kept until feature services are cut over to PoolManager and
    // PgConnectionService is deleted in a later task. Keeps DI resolvable.
    PgConnectionService,
  ],
  exports: [PoolManager, DbDriverRegistry, PgDriver, PgConnectionService],
})
export class DatabaseModule {}
