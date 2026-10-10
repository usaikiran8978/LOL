import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AuditLogsController } from './audit/audit-logs.controller';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminGuard } from './auth/admin.guard';
import { AdminInviteAcceptController, AdminMfaController, AdminsController } from './auth/admins.controller';
import { AdminContentController, AdminGeoController, AdminPlatformConfigController, AdminTaxonomyController } from './config/admin-config.controller';

@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [AdminAuthController, AdminMfaController, AdminInviteAcceptController, AdminsController, AuditLogsController, AdminTaxonomyController, AdminGeoController, AdminPlatformConfigController, AdminContentController],
  providers: [AdminAuthService, AdminGuard],
  exports: [AdminAuthService, AdminGuard],
})
export class AdminModule {}
