import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  accountRecoveryRequest, changePasswordRequest, loginRequest, otpLoginRequest, otpRequest, passwordResetRequest,
  refreshRequest, registerRequest, sendVerificationRequest, socialLoginRequest, verifyContactRequest,
} from '@amora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, UserAuthGuard, type AuthContext } from './auth.guard';
import { AuthService } from './auth.service';

// Per-IP limits on unauthenticated endpoints, in addition to per-account lockout and per-destination OTP caps.
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(STRICT)
  register(@Body(new ZodPipe(registerRequest)) body: z.infer<typeof registerRequest>, @Req() req: Request) {
    return this.auth.register(body, clientContext(req));
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  login(@Body(new ZodPipe(loginRequest)) body: z.infer<typeof loginRequest>, @Req() req: Request) {
    return this.auth.login(body.identifier, body.password, body.device, clientContext(req));
  }

  @Post('otp/request')
  @HttpCode(202)
  @Throttle(STRICT)
  async requestOtp(@Body(new ZodPipe(otpRequest)) body: z.infer<typeof otpRequest>, @Req() req: Request) {
    await this.auth.requestPublicOtp(body.channel, body.destination, body.purpose, clientContext(req));
    return { accepted: true };
  }

  @Post('otp/login')
  @HttpCode(200)
  @Throttle(STRICT)
  otpLogin(@Body(new ZodPipe(otpLoginRequest)) body: z.infer<typeof otpLoginRequest>, @Req() req: Request) {
    return this.auth.loginWithOtp(body.phone, body.code, body.device, clientContext(req));
  }

  @Post('social')
  @HttpCode(200)
  @Throttle(STRICT)
  social(@Body(new ZodPipe(socialLoginRequest)) body: z.infer<typeof socialLoginRequest>, @Req() req: Request) {
    return this.auth.socialLogin(body, clientContext(req));
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Body(new ZodPipe(refreshRequest)) body: z.infer<typeof refreshRequest>, @Req() req: Request) {
    const { tokens } = await this.auth.refresh(body.refreshToken, clientContext(req));
    return tokens;
  }

  @Post('password/reset')
  @HttpCode(204)
  @Throttle(STRICT)
  async resetPassword(@Body(new ZodPipe(passwordResetRequest)) body: z.infer<typeof passwordResetRequest>, @Req() req: Request) {
    await this.auth.resetPassword(body.channel, body.destination, body.code, body.newPassword, clientContext(req));
  }

  @Post('recovery')
  @HttpCode(200)
  @Throttle(STRICT)
  recover(@Body(new ZodPipe(accountRecoveryRequest)) body: z.infer<typeof accountRecoveryRequest>, @Req() req: Request) {
    return this.auth.recoverAccount(body, clientContext(req));
  }

  // ---- authenticated

  @Post('verification/send')
  @HttpCode(202)
  @UseGuards(UserAuthGuard)
  @Throttle(STRICT)
  async sendVerification(@CurrentUser() user: AuthContext, @Body(new ZodPipe(sendVerificationRequest)) body: z.infer<typeof sendVerificationRequest>, @Req() req: Request) {
    await this.auth.sendContactVerification(user.userId, body.channel, clientContext(req));
    return { accepted: true };
  }

  @Post('verification/confirm')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Throttle(STRICT)
  verify(@CurrentUser() user: AuthContext, @Body(new ZodPipe(verifyContactRequest)) body: z.infer<typeof verifyContactRequest>, @Req() req: Request) {
    return this.auth.verifyContact(user.userId, body.channel, body.code, clientContext(req));
  }

  @Post('password/change')
  @HttpCode(204)
  @UseGuards(UserAuthGuard)
  @Throttle(STRICT)
  async changePassword(@CurrentUser() user: AuthContext, @Body(new ZodPipe(changePasswordRequest)) body: z.infer<typeof changePasswordRequest>, @Req() req: Request) {
    await this.auth.changePassword(user.userId, user.sessionId, body.currentPassword, body.newPassword, clientContext(req));
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(UserAuthGuard)
  async logout(@CurrentUser() user: AuthContext, @Req() req: Request) {
    await this.auth.logout(user.userId, user.sessionId, clientContext(req));
  }
}
