import { Module } from '@nestjs/common';
import { AdminDatesController } from './admin-dates.controller';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CallsService } from '../calls/calls.service';
import { CoupleService } from '../calls/couple.service';
import { EventsService } from '../events/events.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { SafetyModule } from '../safety/safety.module';
import { DateSafetyService } from './date-safety.service';
import { DatesService } from './dates.service';
import { AdminEventsController, CallsController, DatesController, EventsController, PublicSafetyController } from './experiences.controller';

/** Real-world experiences: events, dates & date safety, calls, couple space (Phase 10). */
@Module({
  imports: [AuthModule, AdminModule, BillingModule, SafetyModule, ProfilesModule],
  controllers: [EventsController, DatesController, PublicSafetyController, CallsController, AdminEventsController, AdminDatesController],
  providers: [EventsService, DatesService, DateSafetyService, CallsService, CoupleService],
})
export class ExperiencesModule {}
