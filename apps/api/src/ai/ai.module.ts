import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { MetadataModule } from '../metadata/metadata.module';
import { AiController } from './ai.controller';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { LlmEndpointController } from './llm-endpoint.controller';
import { LlmEndpointService } from './llm-endpoint.service';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [ConnectionsModule, MetadataModule],
  controllers: [AiController, LlmEndpointController],
  providers: [AiProviderService, AiService, LlmEndpointService, RetrievalService],
})
export class AiModule {}
