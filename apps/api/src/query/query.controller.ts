import { Body, Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import type {
  ExecuteQueryResponse,
  FetchCursorResponse,
  FetchQueryPageResponse,
  OpenCursorResponse,
} from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import type { RequestWithCorrelationId } from '../common/correlation-id.middleware';
import { ConnectionsService } from '../connections/connections.service';
import { CursorSessionService } from './cursor-session.service';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { FetchCursorDto } from './dto/fetch-cursor.dto';
import { FetchQueryPageDto } from './dto/fetch-query-page.dto';
import { OpenCursorDto } from './dto/open-cursor.dto';
import { QueryService } from './query.service';

@Controller('connections')
export class QueryController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly queryService: QueryService,
    private readonly cursorSessions: CursorSessionService,
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

  /** Fetches the next page of a single SELECT result (the editor's "Load more"). */
  @Post(':id/query/page')
  async page(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: FetchQueryPageDto,
  ): Promise<FetchQueryPageResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.queryService.fetchPage(id, dto.sql, dto.offset, dto.limit, dto.sortBy, dto.sortDir);
  }

  /** Opens a forward-only streaming cursor for a single SELECT (large editor results). */
  @Post(':id/query/cursor')
  async openCursor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenCursorDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<OpenCursorResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.cursorSessions.open(id, user.userId, dto.sql, req.correlationId, dto.sortBy, dto.sortDir);
  }

  /** Pulls the next forward block from an open cursor session. */
  @Post(':id/query/cursor/:sessionId/fetch')
  async fetchCursor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: FetchCursorDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<FetchCursorResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.cursorSessions.fetch(id, user.userId, sessionId, dto.limit, req.correlationId);
  }

  /** Closes a cursor session (new run / navigate away). */
  @Delete(':id/query/cursor/:sessionId')
  @HttpCode(204)
  async closeCursor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.connectionsService.assertOwnership(user.userId, id);
    await this.cursorSessions.close(id, user.userId, sessionId);
  }
}
