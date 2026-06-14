import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttles by authenticated user ID (JWT `sub`) rather than IP address.
 * Used on endpoints where cost is per-user (e.g. AI chat), applied after JwtAuthGuard
 * has already populated `req.user` via the global APP_GUARD.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { sub?: string } | undefined;
    return user?.sub ?? (req['ip'] as string);
  }
}
