import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { adminLoginRequest } from '@amora/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { clientContext } from '../../../common/http/request-context';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { AdminAuthService, type AdminContext } from './admin-auth.service';
import { ADMIN_COOKIE, AdminGuard, AllowWithoutMfa, CurrentAdmin, RequirePermissions, SkipCsrf } from './admin.guard';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body(new ZodPipe(adminLoginRequest)) body: z.infer<typeof adminLoginRequest>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.adminAuth.login(body.email, body.password, body.totp, clientContext(req));
    res.cookie(ADMIN_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: this.cfg.ADMIN_COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      expires: result.expiresAt,
    });
    // CSRF token is returned in the body; the admin app keeps it in memory and sends it as X-CSRF-Token.
    return { admin: result.admin, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() };
  }

  // Any authenticated admin may read their own identity and log out; an empty permission list means "authenticated".
  @Get('me')
  @UseGuards(AdminGuard)
  @RequirePermissions()
  @AllowWithoutMfa()
  me(@CurrentAdmin() admin: AdminContext) {
    return {
      id: admin.adminId, email: admin.email, displayName: admin.displayName, mfaEnabled: admin.mfaEnabled, mfaSetupRequired: this.cfg.ADMIN_REQUIRE_MFA && !admin.mfaEnabled,
      sessionExpiresAt: admin.sessionExpiresAt, permissions: [...admin.permissions].sort(), countryScope: admin.countryScope,
    };
  }

  /** Re-issues the CSRF token for an existing cookie session. Readable only same-origin (CORS + SameSite=Strict). */
  @Post('csrf')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @RequirePermissions()
  @SkipCsrf()
  @AllowWithoutMfa()
  async csrf(@CurrentAdmin() admin: AdminContext) {
    return { csrfToken: await this.adminAuth.rotateCsrf(admin) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermissions()
  @SkipCsrf()
  @AllowWithoutMfa()
  async logout(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.adminAuth.logout(admin, clientContext(req));
    res.clearCookie(ADMIN_COOKIE, { path: '/' });
  }
}
