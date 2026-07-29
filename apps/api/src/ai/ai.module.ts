import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { DdlModule } from '../ddl/ddl.module';
import { HistoryModule } from '../history/history.module';
import { MetadataModule } from '../metadata/metadata.module';
import { QueryModule } from '../query/query.module';
import { AiController } from './ai.controller';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { LlmEndpointController } from './llm-endpoint.controller';
import { LlmEndpointService } from './llm-endpoint.service';
import { RetrievalService } from './retrieval.service';

@Module({
  // DdlModule supplies `DdlService` — Phase 33 routes AI suggestions through its existing preview
  // (validation + SQL rendering) rather than adding a second DDL path.
  imports: [ConnectionsModule, MetadataModule, HistoryModule, QueryModule, DdlModule],
  controllers: [AiController, LlmEndpointController],
  providers: [AiProviderService, AiService, LlmEndpointService, RetrievalService],
})
export class AiModule {}
