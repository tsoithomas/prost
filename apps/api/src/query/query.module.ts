import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [ConnectionsModule, MetadataModule],
  controllers: [QueryController],
  providers: [QueryService],
})
export class QueryModule {}
