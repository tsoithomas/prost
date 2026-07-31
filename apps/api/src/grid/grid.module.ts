import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { AuditModule } from '../audit/audit.module';
import { PreferenceModule } from '../preference/preference.module';
import { GridController } from './grid.controller';
import { GridService } from './grid.service';

@Module({
  imports: [ConnectionsModule, MetadataModule, AuditModule, PreferenceModule],
  controllers: [GridController],
  providers: [GridService],
})
export class GridModule {}
