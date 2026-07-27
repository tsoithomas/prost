import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { AuditModule } from '../audit/audit.module';
import { DdlController } from './ddl.controller';
import { DdlService } from './ddl.service';

@Module({
  imports: [ConnectionsModule, MetadataModule, AuditModule],
  controllers: [DdlController],
  providers: [DdlService],
  exports: [DdlService],
})
export class DdlModule {}
