import { Body, Controller, Param, Post } from '@nestjs/common';
import type { QueryResult } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { QueryService } from './query.service';

@Controller('connections')
export class QueryController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly queryService: QueryService,
  ) {}

  @Post(':id/query')
  async execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExecuteQueryDto,
  ): Promise<QueryResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.queryService.execute(id, dto.sql);
  }
}
