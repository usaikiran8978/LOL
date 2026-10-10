import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@amora/shared';
import type { Request } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { Inject } from '@nestjs/common';
import { AdminAuthService, type AdminContext } from './admin-auth.service';

export const ADMIN_COOKIE = 'amora_admin';
const PERMISSIONS_KEY = 'admin:permissions';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminContext;
  }
}

/** Requires ALL listed permissions. Every admin endpoint must declare at least one. */
const SKIP_CSRF_KEY = 'admin:skipCsrf';
const ALLOW_NO_MFA_KEY = 'admin:allowNoMfa';
/** Endpoints reachable before MFA enrolment (me, logout, MFA setup) when MFA is mandatory. */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_NO_MFA_KEY, true);
/** For endpoints safe without CSRF: logout (SameSite=Strict cookie already blocks cross-site use). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token: string | undefined = req.cookies?.[ADMIN_COOKIE];
    if (!token) throw new AppError('UNAUTHENTICATED');
    const skipCsrf = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF_KEY, [ctx.getHandler(), ctx.getClass()]);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !skipCsrf;
    const admin = await this.adminAuth.authenticate(token, req.header('x-csrf-token'), mutating);

    if (this.cfg.ADMIN_REQUIRE_MFA && !admin.mfaEnabled && !this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_NO_MFA_KEY, [ctx.getHandler(), ctx.getClass()])) {
      throw new AppError('MFA_SETUP_REQUIRED');
    }
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (required === undefined) throw new AppError('FORBIDDEN', 'Endpoint declares no permission'); // fail closed
    const missing = required.filter((p) => !admin.permissions.has(p));
    if (missing.length) throw new AppError('FORBIDDEN', 'Missing permission', { missing });

    req.admin = admin;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  const admin = ctx.switchToHttp().getRequest<Request>().admin;
  if (!admin) throw new AppError('UNAUTHENTICATED');
  return admin;
});
