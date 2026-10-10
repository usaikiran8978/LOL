import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { AnalyticsService } from './analytics/analytics.service';
import { AuditService } from './audit/audit.service';
import { APP_CONFIG, type AppConfig } from './config/config';
import { FIELD_ENCRYPTION, FieldEncryption, parseRetiredKeys } from './crypto/field-encryption';
import { createDatabase, DATABASE, type Database } from './db/database';
import { JobScheduler } from './jobs/scheduler';
import { MessagingService, messagingProviders } from './messaging/messaging';
import { OutboxService } from './outbox/outbox.service';
import { RealtimeBus } from './realtime/realtime-bus';
import { LocalDiskObjectStorage } from './storage/local-disk-storage';
import { InMemoryObjectStorage, OBJECT_STORAGE, S3ObjectStorage, UnconfiguredObjectStorage } from './storage/object-storage';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => createDatabase(cfg.DATABASE_URL, cfg.DATABASE_POOL_MAX),
    },
    { provide: FIELD_ENCRYPTION, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new FieldEncryption(cfg.FIELD_ENCRYPTION_KEY, cfg.FIELD_ENCRYPTION_KEY_VERSION, parseRetiredKeys(cfg.FIELD_ENCRYPTION_RETIRED_KEYS)) },
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.S3_BUCKET === 'memory' && cfg.NODE_ENV === 'test'
          ? new InMemoryObjectStorage()
          : cfg.S3_BUCKET === 'local'
          ? new LocalDiskObjectStorage(cfg.LOCAL_STORAGE_DIR, cfg.PUBLIC_API_URL, cfg.SIGNING_SECRET)
          : cfg.S3_BUCKET
          ? new S3ObjectStorage(cfg.S3_BUCKET, {
              region: cfg.S3_REGION,
              endpoint: cfg.S3_ENDPOINT,
              forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
              accessKeyId: cfg.S3_ACCESS_KEY_ID,
              secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
            })
          : new UnconfiguredObjectStorage(),
    },
    AuditService,
    AnalyticsService,
    OutboxService,
    JobScheduler,
    RealtimeBus,
    ...messagingProviders,
    MessagingService,
  ],
  exports: [DATABASE, FIELD_ENCRYPTION, OBJECT_STORAGE, AuditService, AnalyticsService, OutboxService, JobScheduler, RealtimeBus, MessagingService],
})
export class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
