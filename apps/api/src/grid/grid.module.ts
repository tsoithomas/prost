import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { GridController } from './grid.controller';
import { GridService } from './grid.service';

@Module({
  imports: [ConnectionsModule, MetadataModule],
  controllers: [GridController],
  providers: [GridService],
})
export class GridModule {}
