import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Assigns a request id (accepting a well-formed upstream X-Request-Id) and echoes it back. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export function clientContext(req: Request): ClientContext {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 512) ?? null, requestId: req.requestId };
}
