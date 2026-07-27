import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { AuditAction, AuditExportEntry, AuditListResponse, AuditOutcome, AuditQuery } from '@prost/shared-types';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { AuditService } from './audit.service';

/**
 * Top-level audit routes (Phase 28). Ownership is enforced inside the service by `userId`-scoped
 * queries, so no per-connection gate is needed. Filters + cursor come from query params.
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string | undefined>): Promise<AuditListResponse> {
    return this.auditService.list(user.userId, this.parseQuery(query));
  }

  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string | undefined>): Promise<AuditExportEntry[]> {
    return this.auditService.exportAll(user.userId, this.parseQuery(query));
  }

  private parseQuery(query: Record<string, string | undefined>): AuditQuery {
    const { action, outcome } = query;
    if (action !== undefined && !AUDIT_ACTIONS.includes(action as AuditAction)) {
      throw new BadRequestException(`Invalid action "${action}"`);
    }
    if (outcome !== undefined && !AUDIT_OUTCOMES.includes(outcome as AuditOutcome)) {
      throw new BadRequestException(`Invalid outcome "${outcome}"`);
    }
    return {
      ...(query.connectionId ? { connectionId: query.connectionId } : {}),
      ...(action ? { action: action as AuditAction } : {}),
      ...(outcome ? { outcome: outcome as AuditOutcome } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    };
  }
}
