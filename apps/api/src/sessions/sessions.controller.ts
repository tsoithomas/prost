import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { DbSession } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { KillSessionDto } from './dto/kill-session.dto';
import { SessionsService } from './sessions.service';

@Controller('connections')
export class SessionsController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly sessionsService: SessionsService,
  ) {}

  /** A snapshot of the target's live sessions (Phase 27). Read-only; always allowed. */
  @Get(':id/sessions')
  async list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<DbSession[]> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.sessionsService.listSessions(id);
  }

  /** Cancel (graceful) or terminate (force) a session. Write-class — rejected on read-only connections. */
  @Post(':id/sessions/:sessionId/kill')
  @HttpCode(204)
  async kill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: KillSessionDto,
  ): Promise<void> {
    await this.connectionsService.assertOwnership(user.userId, id);
    await this.sessionsService.killSession(id, sessionId, dto.mode);
  }
}
