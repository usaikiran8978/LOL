import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { assertUserCanAuthenticate, TokenService } from './token.service';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/**
 * Bearer-token guard for user endpoints. Besides the JWT signature/expiry it checks that the session is still live
 * and the user's token_version matches, so logout, force-logout and bans take effect immediately.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(header.slice(7));

    const row = await this.db
      .selectFrom('user_sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.revoked_at', 's.expires_at', 'u.status', 'u.status_until', 'u.token_version'])
      .where('s.id', '=', claims.sessionId)
      .where('s.user_id', '=', claims.userId)
      .executeTakeFirst();
    if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || row.token_version !== claims.tokenVersion) {
      throw new AppError('TOKEN_INVALID');
    }
    assertUserCanAuthenticate(row.status, row.status_until);
    req.auth = { userId: claims.userId, sessionId: claims.sessionId };
    // Activity recency feeds ranking and 'recently active'; written at most every 5 minutes per user.
    await this.db.updateTable('users').set({ last_active_at: new Date() }).where('id', '=', claims.userId)
      .where((eb) => eb.or([eb('last_active_at', 'is', null), eb('last_active_at', '<', new Date(Date.now() - 300_000))])).execute();
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw new AppError('UNAUTHENTICATED');
  return auth;
});
