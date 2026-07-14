import { Body, Controller, HttpCode, HttpException, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ChatResponse } from '@prost/shared-types';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import type { TokenUsage } from './ai-provider.service';
import { ChatDto } from './dto/chat.dto';

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
