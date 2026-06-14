import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { ChatResponse } from '@prost/shared-types';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

@Controller('connections')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @SkipThrottle()
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { ttl: Number(process.env['THROTTLE_AI_TTL_MS'] ?? 60_000), limit: Number(process.env['THROTTLE_AI_LIMIT'] ?? 20) } })
  @Post(':id/ai/chat')
  @HttpCode(200)
  async chat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChatDto,
  ): Promise<ChatResponse> {
    return this.aiService.chat(user.userId, id, dto);
  }
}
