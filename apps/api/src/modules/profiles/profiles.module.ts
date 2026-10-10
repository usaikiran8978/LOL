import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationService } from './location.service';
import { MediaService } from './media.service';
import { OnboardingService } from './onboarding.service';
import { PreferencesService } from './preferences.service';
import { ProfileStateService } from './profile-state.service';
import { LocationController, MediaController, OnboardingController, PreferencesController, ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfilesController, MediaController, PreferencesController, LocationController, OnboardingController],
  providers: [ProfilesService, MediaService, ProfileStateService, PreferencesService, LocationService, OnboardingService],
  exports: [ProfilesService, MediaService, ProfileStateService, OnboardingService, PreferencesService],
})
export class ProfilesModule {}
