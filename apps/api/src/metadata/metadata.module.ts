import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataController } from './metadata.controller';
import { MetadataService } from './metadata.service';

@Module({
  imports: [ConnectionsModule],
  controllers: [MetadataController],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
