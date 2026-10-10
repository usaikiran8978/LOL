import { Global, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminAnalyticsController } from './analytics.controller';
import { ExperimentsService } from './experiments.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({ imports: [AdminModule], controllers: [AdminAnalyticsController], providers: [MetricsService, ExperimentsService], exports: [MetricsService, ExperimentsService] })
export class AnalyticsModule {}
