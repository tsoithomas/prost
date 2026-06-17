import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DB_DRIVERS, type DbDriver } from './db-driver.interface';

@Injectable()
export class DbDriverRegistry {
  private readonly byEngine: Map<string, DbDriver>;

  constructor(@Inject(DB_DRIVERS) drivers: DbDriver[]) {
    this.byEngine = new Map(drivers.map((d) => [d.engine, d]));
  }

  get(engine: string): DbDriver {
    const driver = this.byEngine.get(engine);
    if (!driver) throw new BadRequestException(`Unsupported database engine "${engine}"`);
    return driver;
  }
}
