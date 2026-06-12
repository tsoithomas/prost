import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

/**
 * Assigns a correlation id to every request (returned via the X-Correlation-Id header and
 * embedded in error envelopes), and logs route/status/duration on completion (architecture
 * principle #12).
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');

  use(req: RequestWithCorrelationId, res: Response, next: NextFunction): void {
    const correlationId = randomUUID();
    const start = Date.now();
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    res.on('finish', () => {
      this.logger.log(
        `${req.method} ${req.originalUrl} -> ${res.statusCode} durationMs=${Date.now() - start} correlationId=${correlationId}`,
      );
    });

    next();
  }
}
