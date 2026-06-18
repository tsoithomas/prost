import { Global, Module } from '@nestjs/common';
import { DatabaseEnginesController } from './database-engines.controller';
import { DB_DRIVERS } from './db-driver.interface';
import { DbDriverRegistry } from './db-driver.registry';
import { PoolManager } from './pool-manager.service';
import { MysqlDriver } from './drivers/mysql/mysql-driver';
import { PgDriver } from './drivers/pg/pg-driver';
import { SqliteDriver } from './drivers/sqlite/sqlite-driver';

@Global()
@Module({
  controllers: [DatabaseEnginesController],
  providers: [
    PgDriver,
    MysqlDriver,
    SqliteDriver,
    {
      provide: DB_DRIVERS,
      useFactory: (pg: PgDriver, mysql: MysqlDriver, sqlite: SqliteDriver) => [pg, mysql, sqlite],
      inject: [PgDriver, MysqlDriver, SqliteDriver],
    },
    DbDriverRegistry,
    PoolManager,
  ],
  exports: [PoolManager, DbDriverRegistry, PgDriver, MysqlDriver, SqliteDriver],
})
export class DatabaseModule {}
