import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigController } from './config.controller';
import { EntitlementsService } from './entitlements.service';
import { FlagsService } from './flags.service';
import { OptionalUserAuthGuard } from './optional-auth.guard';
import { SettingsService } from './settings.service';
import { UserFactsService } from './user-facts.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ConfigController],
  providers: [FlagsService, SettingsService, UserFactsService, OptionalUserAuthGuard, EntitlementsService],
  exports: [FlagsService, SettingsService, UserFactsService, OptionalUserAuthGuard, EntitlementsService],
})
export class PlatformModule {}
