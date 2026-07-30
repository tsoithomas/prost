import { Body, Controller, HttpCode, HttpException, Logger, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type {
  ChartSuggestResponse,
  ChatResponse,
  DescribeObjectResponse,
  RunReadQueryResponse,
  SchemaSuggestResponse,
} from '@prost/shared-types';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import type { RequestWithCorrelationId } from '../common/correlation-id.middleware';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import type { TokenUsage } from './ai-provider.service';
import { ChatDto } from './dto/chat.dto';
import { ChartSuggestDto } from './dto/chart-suggest.dto';
import { DescribeObjectDto } from './dto/describe-object.dto';
import { RunReadQueryDto } from './dto/run-read-query.dto';
import { SchemaSuggestDto } from './dto/schema-suggest.dto';

const AI_THROTTLE = {
  default: {
    ttl: Number(process.env['THROTTLE_AI_TTL_MS'] ?? 60_000),
    limit: Number(process.env['THROTTLE_AI_LIMIT'] ?? 20),
  },
};

/**
 * A safe, non-leaking parenthetical hint about *why* a call failed, appended to a base message.
 * An `openai` `APIError` carries an HTTP `status` (401 = bad key, 404 = bad base URL / model,
 * 400 = unsupported param such as a reasoning model rejecting `max_tokens`, 429 = rate limited);
 * Node connection errors carry a `code` (`ECONNREFUSED` = server unreachable — the target DB during
 * context-building, or the LLM endpoint during the call). Neither includes the API key.
 */
function errorHint(err: unknown): string {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') return ` (HTTP ${status})`;
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string') return ` (${code})`;
  return '';
}

@Controller('connections')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle(AI_THROTTLE)
  @Post(':id/ai/chat')
  @HttpCode(200)
  async chat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChatDto,
  ): Promise<ChatResponse> {
    return this.aiService.chat(user.userId, id, dto);
  }

  /**
   * Suggest a chart for an already-loaded result page. The client sends only column metadata + a small
   * row sample; the response is a validated suggestion or `null` (manual charting works regardless).
   */
  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle(AI_THROTTLE)
  @Post(':id/ai/chart-suggest')
  @HttpCode(200)
  async chartSuggest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChartSuggestDto,
  ): Promise<ChartSuggestResponse> {
    const suggestion = await this.aiService.suggestChart(user.userId, id, dto);
    return { suggestion };
  }

  /**
   * Run a read-only SELECT the assistant proposed, on the user's confirmation (Phase 31). Proven +
   * engine-enforced read-only in `runReadQuery`; a non-read statement is refused (422). Returns the full
   * bounded page (for the grid) plus a sanitized sample (for the model).
   */
  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle(AI_THROTTLE)
  @Post(':id/ai/run-read-query')
  @HttpCode(200)
  async runReadQuery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RunReadQueryDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<RunReadQueryResponse> {
    return this.aiService.runReadQuery(user.userId, id, dto.sql, req.correlationId);
  }

  /**
   * Propose schema changes — typed DDL requests, never SQL (Phase 33). Every candidate is filtered
   * through the suggestable allow-list and re-validated against live metadata via the existing DDL
   * preview, so only changes that actually compile are returned; applying one still goes through the
   * normal DDL confirm → execute path. Rejected outright (403) on read-only connections.
   */
  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle(AI_THROTTLE)
  @Post(':id/ai/schema-suggest')
  @HttpCode(200)
  async schemaSuggest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SchemaSuggestDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<SchemaSuggestResponse> {
    const suggestions = await this.aiService.suggestSchemaChanges(
      user.userId,
      id,
      dto,
      req.correlationId,
    );
    return { suggestions };
  }

  /**
   * Draft a table/column description (Phase 38). Returns prose for the user to edit — nothing is
   * written here; applying it still goes through the DDL preview → confirm → execute path. Rejected
   * on read-only connections, like every other write-adjacent AI call.
   */
  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle(AI_THROTTLE)
  @Post(':id/ai/describe-object')
  @HttpCode(200)
  async describeObject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DescribeObjectDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<DescribeObjectResponse> {
    return this.aiService.describeObject(user.userId, id, dto, req.correlationId);
  }

  /**
   * Streaming chat over Server-Sent Events. Validation (ownership/endpoint/model) runs eagerly and,
   * on failure, returns a normal JSON error *before* any SSE frame is written; once the stream is
   * open, a mid-stream provider failure is reported as an `error` event. Frames: `{ delta }` per
   * token, then a terminal `done` event.
   */
  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle(AI_THROTTLE)
  @Post(':id/ai/chat/stream')
  async chatStream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ): Promise<void> {
    let usage: TokenUsage | undefined;
    let stream: AsyncIterable<string>;
    try {
      stream = await this.aiService.streamChat(user.userId, id, dto, (u) => {
        usage = u;
      });
    } catch (err) {
      if (err instanceof HttpException) {
        res.status(err.getStatus()).json({ message: err.message });
      } else {
        this.logger.error('AI stream setup failed', err instanceof Error ? err.stack : String(err));
        res.status(500).json({ message: `AI request failed${errorHint(err)}.` });
      }
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const delta of stream) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      // Emit token usage (if the endpoint reported it) just before signalling completion.
      if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
      res.write('event: done\ndata: {}\n\n');
    } catch (err) {
      // The real provider error is logged here (the client only gets a safe status hint), so an
      // API-key/model/URL/connectivity failure is diagnosable from the server console.
      this.logger.error('AI provider stream failed', err instanceof Error ? err.stack : String(err));
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: `AI provider request failed${errorHint(err)}.` })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
