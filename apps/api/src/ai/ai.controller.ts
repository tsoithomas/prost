import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { ChatResponse } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

@Controller('connections')
export class AiController {
  constructor(private readonly aiService: AiService) {}

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
