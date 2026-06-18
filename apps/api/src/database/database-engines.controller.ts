import { Controller, Get } from '@nestjs/common';
import type { DbEngineDescriptor } from '@prost/shared-types';
import { DbDriverRegistry } from './db-driver.registry';

@Controller('database-engines')
export class DatabaseEnginesController {
  constructor(private readonly registry: DbDriverRegistry) {}

  @Get()
  list(): DbEngineDescriptor[] {
    return this.registry.listDescriptors();
  }
}
