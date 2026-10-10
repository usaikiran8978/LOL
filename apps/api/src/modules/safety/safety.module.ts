import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { IMAGE_MODERATION, RekognitionImageModeration } from './image-moderation';
import { ModerationService } from './moderation.service';
import { AdminModerationController, AdminReviewController, AdminUsersController } from './safety-admin.controller';
import { SafetyAutomationService } from './safety-automation.service';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [AuthModule, ProfilesModule, AdminModule],
  controllers: [SafetyController, AdminModerationController, AdminReviewController, AdminUsersController],
  providers: [
    ModerationService, SafetyService, VerificationService, SafetyAutomationService,
    {
      provide: IMAGE_MODERATION,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => (cfg.IMAGE_MODERATION_PROVIDER === 'rekognition' && cfg.S3_BUCKET ? new RekognitionImageModeration(cfg.S3_BUCKET, cfg.S3_REGION) : null),
    },
  ],
  exports: [ModerationService, SafetyService, VerificationService],
})
export class SafetyModule {}
