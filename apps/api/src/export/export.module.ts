import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { QueryModule } from '../query/query.module';
import { PreferenceModule } from '../preference/preference.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [ConnectionsModule, MetadataModule, QueryModule, PreferenceModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
