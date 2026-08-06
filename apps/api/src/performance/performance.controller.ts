import { Controller, Get, Param } from '@nestjs/common';
import type { PerformanceInsightsSnapshot } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { PerformanceService } from './performance.service';

@Controller('connections')
export class PerformanceController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly performanceService: PerformanceService,
  ) {}

  /** A bounded, pull-only snapshot of normalized statements (Phase 41). */
  @Get(':id/perf/statements')
  async statements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PerformanceInsightsSnapshot> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.performanceService.getSnapshot(id);
  }
}
