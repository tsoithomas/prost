import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { CreateSnippetRequest, SnippetDto, UpdateSnippetRequest } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { SnippetService } from './snippet.service';

@Controller('snippets')
export class SnippetController {
  constructor(private readonly snippetService: SnippetService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<SnippetDto[]> {
    return this.snippetService.list(user.userId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateSnippetRequest): Promise<SnippetDto> {
    return this.snippetService.create(user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateSnippetRequest,
  ): Promise<SnippetDto> {
    return this.snippetService.update(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.snippetService.remove(user.userId, id);
  }
}
