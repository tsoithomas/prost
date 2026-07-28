import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { AuditModule } from '../audit/audit.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [ConnectionsModule, MetadataModule, AuditModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
