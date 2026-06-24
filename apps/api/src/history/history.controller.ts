import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Query } from '@nestjs/common';
import type { HistoryExportEntry, QueryHistoryDto, UpdateHistoryRequest } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { HistoryService } from './history.service';

@Controller('connections')
export class HistoryController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly historyService: HistoryService,
  ) {}

  @Get(':id/history')
  async getHistory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<QueryHistoryDto[]> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.historyService.listRecent(user.userId, id);
  }
}

/**
 * Top-level history management routes. Ownership is enforced inside the service by `userId`-scoped
 * queries (another user's entry id → 404), so these need no per-connection ownership gate. Omitting
 * `connectionId` on search/clear means "all connections" (the caller's own history only).
 */
@Controller('history')
export class HistoryManagementController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('connectionId') connectionId?: string,
    @Query('limit') limit?: string,
  ): Promise<QueryHistoryDto[]> {
    return this.historyService.search(user.userId, {
      search,
      connectionId,
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
  }

  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser): Promise<HistoryExportEntry[]> {
    return this.historyService.exportAll(user.userId);
  }

  @Patch(':entryId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId') entryId: string,
    @Body() body: UpdateHistoryRequest,
  ): Promise<QueryHistoryDto> {
    return this.historyService.update(user.userId, entryId, body);
  }

  @Delete(':entryId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('entryId') entryId: string): Promise<void> {
    return this.historyService.remove(user.userId, entryId);
  }

  @Delete()
  @HttpCode(204)
  clear(@CurrentUser() user: AuthenticatedUser, @Query('connectionId') connectionId?: string): Promise<void> {
    return this.historyService.clear(user.userId, connectionId);
  }
}
