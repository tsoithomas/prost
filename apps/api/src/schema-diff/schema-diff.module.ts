import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { DdlModule } from '../ddl/ddl.module';
import { SchemaDiffController } from './schema-diff.controller';
import { SchemaDiffService } from './schema-diff.service';

@Module({
  // DdlModule supplies `DdlService` — the migration change-set re-validates through its existing
  // `preview`, exactly as Phase 33's AI schema suggestions do; applying a change reuses DdlModule's own
  // controller routes, so this module needs no execute path of its own.
  imports: [ConnectionsModule, MetadataModule, DdlModule],
  controllers: [SchemaDiffController],
  providers: [SchemaDiffService],
})
export class SchemaDiffModule {}
