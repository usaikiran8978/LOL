import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UserAuthGuard } from '../auth/auth.guard';

/** Authenticates when a bearer token is present; anonymous otherwise. Invalid tokens are still rejected. */
@Injectable()
export class OptionalUserAuthGuard implements CanActivate {
  constructor(private readonly inner: UserAuthGuard) {}

  canActivate(ctx: ExecutionContext): Promise<boolean> | boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.header('authorization')) return true;
    return this.inner.canActivate(ctx);
  }
}
