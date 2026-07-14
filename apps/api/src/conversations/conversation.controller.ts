import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { ConversationDetailDto, ConversationDto } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { AppendMessagesDto, RenameConversationDto } from './dto/conversation.dto';
import { ConversationService } from './conversation.service';

/** Persistent AI chat threads, scoped to a connection the user owns. */
@Controller('connections/:id/conversations')
export class ConversationController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly connections: ConnectionsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') connectionId: string,
  ): Promise<ConversationDto[]> {
    await this.connections.assertOwnership(user.userId, connectionId);
    return this.conversations.list(user.userId, connectionId);
  }

  @Get(':conversationId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDetailDto> {
    return this.conversations.get(user.userId, conversationId);
  }

  @Post()
  @HttpCode(200)
  async append(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') connectionId: string,
    @Body() dto: AppendMessagesDto,
  ): Promise<ConversationDto> {
    await this.connections.assertOwnership(user.userId, connectionId);
    return this.conversations.append(user.userId, connectionId, dto.conversationId, dto.messages);
  }

  @Patch(':conversationId')
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: RenameConversationDto,
  ): Promise<ConversationDto> {
    return this.conversations.rename(user.userId, conversationId, dto.title);
  }

  @Delete(':conversationId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    await this.conversations.remove(user.userId, conversationId);
  }
}
