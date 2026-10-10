import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { consentUpdate } from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users/me')
@UseGuards(UserAuthGuard)
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user.userId);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthContext) {
    return this.users.listSessions(user.userId, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    await this.users.revokeSession(user.userId, id, clientContext(req));
  }

  @Post('sessions/revoke-others')
  @HttpCode(204)
  async revokeOthers(@CurrentUser() user: AuthContext, @Req() req: Request) {
    await this.users.revokeOtherSessions(user.userId, user.sessionId, clientContext(req));
  }

  @Get('consents')
  consents(@CurrentUser() user: AuthContext) {
    return this.users.currentConsents(user.userId);
  }

  @Post('consents')
  @HttpCode(200)
  updateConsent(@CurrentUser() user: AuthContext, @Body(new ZodPipe(consentUpdate)) body: z.infer<typeof consentUpdate>, @Req() req: Request) {
    return this.users.recordConsent(user.userId, body.consentType, body.granted, clientContext(req));
  }
}
