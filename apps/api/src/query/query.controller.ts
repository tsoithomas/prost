import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import type { ExecuteQueryResponse } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import type { RequestWithCorrelationId } from '../common/correlation-id.middleware';
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
    @Req() req: RequestWithCorrelationId,
  ): Promise<ExecuteQueryResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.queryService.execute(id, dto.sql, user.userId, req.correlationId, dto.transactional ?? false);
  }
}
