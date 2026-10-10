import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AdminPrivacyController, PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({ imports: [AuthModule, AdminModule, ProfilesModule], controllers: [PrivacyController, AdminPrivacyController], providers: [PrivacyService], exports: [PrivacyService] })
export class PrivacyModule {}
