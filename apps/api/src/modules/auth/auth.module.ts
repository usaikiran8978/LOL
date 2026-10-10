import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { UserAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SocialIdentityService } from './social.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, OtpService, SocialIdentityService, UserAuthGuard],
  exports: [AuthService, TokenService, PasswordService, UserAuthGuard],
})
export class AuthModule {}
