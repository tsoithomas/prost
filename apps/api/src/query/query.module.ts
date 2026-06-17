import { Module } from '@nestjs/common';
import { HistoryModule } from '../history/history.module';
import { MetadataModule } from '../metadata/metadata.module';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [MetadataModule, HistoryModule],
  controllers: [QueryController],
  providers: [QueryService],
})
export class QueryModule {}
