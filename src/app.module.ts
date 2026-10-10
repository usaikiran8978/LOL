import { DynamicModule, Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './common/config/config';
import { CoreModule } from './common/core.module';
import { HttpObservabilityMiddleware, Metrics, MetricsController } from './common/observability/metrics';
import { RedisThrottlerStorage } from './common/redis/redis-throttler.storage';
import { DevStorageController } from './common/storage/dev-storage.controller';
import { GlobalExceptionFilter } from './common/errors/exception.filter';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ContentModule } from './modules/content/content.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChatModule } from './modules/chat/chat.module';
import { ExperiencesModule } from './modules/dates/experiences.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MatchingModule } from './modules/matching/matching.module';
import { SafetyCoreModule } from './modules/safety/safety-core.module';
import { SafetyModule } from './modules/safety/safety.module';
import { QuestionnaireModule } from './modules/questionnaire/questionnaire.module';
import { HealthController } from './modules/health/health.controller';
import { LegalModule } from './modules/legal/legal.module';
import { UsersModule } from './modules/users/users.module';

@Global()
@Module({})
class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] };
  }
}

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpObservabilityMiddleware).forRoutes('{*path}');
  }

  static forRoot(config: AppConfig): DynamicModule {
    const throttleStorage = config.REDIS_URL ? new RedisThrottlerStorage(config.REDIS_URL) : undefined;
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        // Default per-IP budget; sensitive routes tighten it with @Throttle. Counters live in Redis when configured
        // (shared across instances), otherwise in per-instance memory.
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
          skipIf: () => !config.RATE_LIMIT_ENABLED,
          storage: throttleStorage,
        }),
        CoreModule,
        AuthModule,
        PlatformModule,
        CatalogModule,
        UsersModule,
        ProfilesModule,
        ContentModule,
        QuestionnaireModule,
        MatchingModule,
        SafetyCoreModule,
        ChatModule,
        NotificationsModule,
        SafetyModule,
        BillingModule,
        AiModule,
        ExperiencesModule,
        AnalyticsModule,
        PrivacyModule,
        LegalModule,
        AdminModule,
      ],
      controllers: [HealthController, MetricsController, DevStorageController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        Metrics,
        HttpObservabilityMiddleware,
        ...(throttleStorage ? [{ provide: 'THROTTLE_STORAGE_LIFECYCLE', useValue: throttleStorage }] : []),
      ],
    };
  }
}
