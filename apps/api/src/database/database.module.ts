import { Global, Module } from '@nestjs/common';
import { DB_DRIVERS } from './db-driver.interface';
import { DbDriverRegistry } from './db-driver.registry';
import { PoolManager } from './pool-manager.service';
import { PgDriver } from './drivers/pg/pg-driver';
import { SqliteDriver } from './drivers/sqlite/sqlite-driver';

@Global()
@Module({
  providers: [
    PgDriver,
    SqliteDriver,
    {
      provide: DB_DRIVERS,
      useFactory: (pg: PgDriver, sqlite: SqliteDriver) => [pg, sqlite],
      inject: [PgDriver, SqliteDriver],
    },
    DbDriverRegistry,
    PoolManager,
  ],
  exports: [PoolManager, DbDriverRegistry, PgDriver, SqliteDriver],
})
export class DatabaseModule {}
