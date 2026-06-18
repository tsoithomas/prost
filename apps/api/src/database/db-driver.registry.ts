import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { DB_DRIVERS, type DbDriver } from './db-driver.interface';

@Injectable()
export class DbDriverRegistry {
  private readonly byEngine: Map<string, DbDriver>;

  constructor(@Inject(DB_DRIVERS) drivers: DbDriver[]) {
    this.byEngine = new Map();
    for (const driver of drivers) {
      if (this.byEngine.has(driver.engine)) {
        throw new Error(`Duplicate database engine "${driver.engine}"`);
      }
      this.byEngine.set(driver.engine, driver);
    }
  }

  get(engine: string): DbDriver {
    const driver = this.byEngine.get(engine);
    if (!driver) throw new BadRequestException(`Unsupported database engine "${engine}"`);
    return driver;
  }

  listDescriptors(): DbEngineDescriptor[] {
    return Array.from(this.byEngine.values())
      .map((driver) => driver.descriptor)
      .sort((a, b) => a.engine.localeCompare(b.engine));
  }
}
