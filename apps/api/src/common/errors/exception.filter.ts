import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiErrorBody, ErrorCode } from '@amora/shared';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = req.requestId;

    let status = 500;
    let body: ApiErrorBody['error'] = { code: 'INTERNAL', message: 'Internal server error', requestId };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details, requestId };
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      const retry = Number(res.getHeader('Retry-After') ?? res.getHeader('retry-after-default') ?? 60);
      body = { code: 'RATE_LIMITED', message: 'Too many requests', details: { retryAfterSeconds: Number.isFinite(retry) ? retry : 60 }, requestId };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code: ErrorCode = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL';
      body = { code, message: exception.message, requestId };
    }

    // Deliberate AppErrors (e.g. 503 provider not configured) are expected outcomes; only log unexpected failures.
    if (status >= 500 && !(exception instanceof AppError && exception.code !== 'INTERNAL')) {
      this.logger.error({ requestId, path: req.path, err: exception });
    }
    res.status(status).json({ error: body } satisfies ApiErrorBody);
  }
}
