import { Controller, Get, Param } from '@nestjs/common';
import type { QueryHistoryDto } from '@prost/shared-types';
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
