import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { AdminBillingController, BillingController, WebhooksController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [BillingController, WebhooksController, AdminBillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
