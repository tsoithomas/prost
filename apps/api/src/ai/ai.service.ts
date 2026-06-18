import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ChatRequest, ChatResponse } from '@prost/shared-types';
import { ConnectionsService } from '../connections/connections.service';
import { PoolManager } from '../database/pool-manager.service';
import { AiProviderService } from './ai-provider.service';
import { LlmEndpointService } from './llm-endpoint.service';
import { RetrievalService } from './retrieval.service';

@Injectable()
export class AiService {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly llmEndpointService: LlmEndpointService,
    private readonly provider: AiProviderService,
    private readonly retrieval: RetrievalService,
    private readonly pool: PoolManager,
  ) {}

  async chat(userId: string, connectionId: string, req: ChatRequest): Promise<ChatResponse> {
    await this.connectionsService.assertOwnership(userId, connectionId);

    const endpoint = await this.llmEndpointService.getDecrypted(userId, req.endpointId);
    if (!endpoint.models.includes(req.model)) {
      throw new BadRequestException('Model not available on this endpoint');
    }

    const schemaContext = await this.retrieval.buildContext(connectionId);
    const engineLabel = (await this.pool.driverFor(connectionId)).descriptor.label;
    const systemPrompt = buildSystemPrompt(schemaContext, req.mode, engineLabel);

    let content: string;
    try {
      content = await this.provider.complete({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: req.model,
        systemPrompt,
        messages: req.messages,
      });
    } catch {
      throw new ServiceUnavailableException('AI provider request failed.');
    }

    const sqlMatch = content.match(/```sql\n([\s\S]*?)```/);
    const suggestedSql = sqlMatch?.[1]?.trim() ?? undefined;

    return { message: { role: 'assistant', content }, suggestedSql };
  }
}

function buildSystemPrompt(schemaContext: string, mode: string | undefined, engineLabel: string): string {
  const role =
    mode === 'generateSql'
      ? `You are a SQL generator for a ${engineLabel} database.`
      : mode === 'explain'
        ? `You are a SQL explainer for a ${engineLabel} database.`
        : `You are a ${engineLabel} assistant.`;

  return `${role} The database has the following schema:

${schemaContext}

Rules:
- Only reference tables and columns that appear in the schema above. Never invent names.
- When generating SQL, produce safe statements. Wrap SQL in \`\`\`sql code blocks.
- Never suggest DDL or DML that modifies data unless the user explicitly requests it.
- Keep answers concise and accurate.
- Do not reveal connection credentials, passwords, or internal system details.`;
}
