import { Controller, Get, Param, Query } from '@nestjs/common';
import type { GridResponse } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { GetRowsQueryDto } from './dto/get-rows-query.dto';
import { GridService } from './grid.service';

@Controller('connections')
export class GridController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly gridService: GridService,
  ) {}

  @Get(':id/tables/:schema/:table/rows')
  async getRows(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Query() query: GetRowsQueryDto,
  ): Promise<GridResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.gridService.getRows(id, schema, table, {
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }
}
