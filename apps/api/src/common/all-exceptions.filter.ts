import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ErrorCode, ErrorEnvelope } from '@prost/shared-types';
import type { RequestWithCorrelationId } from './correlation-id.middleware';

interface CodedError extends Error {
  code?: string;
}

/** Node/libpq connection-level failures: host unreachable, auth rejected, database missing. */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ECONNRESET',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '28000',
  '28P01',
  '3D000',
]);

/** statement_timeout cancellations and socket-level timeouts. */
const TIMEOUT_ERROR_CODES = new Set(['57014', 'ETIMEDOUT']);

/**
 * Catches every exception and maps it to the safe `{ error, message, correlationId }`
 * envelope (architecture principle #11). Distinguishes auth/validation/not-found (Nest
 * HttpExceptions) from connection/timeout/SQL errors raised by the `pg` driver, and never
 * forwards raw stack traces or driver internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithCorrelationId>();
    const response = ctx.getResponse<Response>();
    const correlationId = request.correlationId ?? randomUUID();

    const { status, body } = classify(exception, correlationId);

    const logMessage = `${request.method} ${request.originalUrl} -> ${status} [${body.error}] correlationId=${correlationId}`;
    if (status >= 500) {
      this.logger.error(logMessage, exception instanceof Error ? exception.stack : String(exception));
    } else {
      this.logger.warn(`${logMessage} message=${body.message}`);
    }

    response.status(status).json(body);
  }
}

function classify(exception: unknown, correlationId: string): { status: number; body: ErrorEnvelope } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      body: { error: errorCodeForStatus(status), message: httpExceptionMessage(exception), correlationId },
    };
  }

  const code = (exception as CodedError)?.code;
  if (typeof code === 'string') {
    if (CONNECTION_ERROR_CODES.has(code)) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        body: { error: 'CONNECTION_ERROR', message: 'Could not connect to the target database.', correlationId },
      };
    }
    if (TIMEOUT_ERROR_CODES.has(code)) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        body: { error: 'TIMEOUT_ERROR', message: 'The query took too long and was cancelled.', correlationId },
      };
    }
    // Any other Postgres SQLSTATE indicates a problem with the query itself.
    return {
      status: HttpStatus.BAD_REQUEST,
      body: {
        error: 'SQL_ERROR',
        message: exception instanceof Error ? exception.message : 'The query could not be executed.',
        correlationId,
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', correlationId },
  };
}

function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
    case HttpStatus.FORBIDDEN:
      return 'AUTH_ERROR';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_ERROR';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMIT_ERROR';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object' && 'message' in response) {
    const { message } = response as { message: unknown };
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return exception.message;
}
