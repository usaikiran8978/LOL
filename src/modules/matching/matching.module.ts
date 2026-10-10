import { Module } from '@nestjs/common';
import { DATABASE, type Database } from '../../common/db/database';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';
import { AdaptiveService } from './adaptive.service';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { FeaturesService } from './features.service';
import { AdminMatchingController } from './matching-admin.controller';
import { MatchingAdminService } from './matching-admin.service';
import { MatchingConfigService } from './matching-config.service';
import { RecommendationsService } from './recommendations.service';
import { OpenSearchIndex, PostgresSearchIndex, SEARCH_INDEX } from './search';
import { SwipesService } from './swipes.service';

@Module({
  imports: [AuthModule, ProfilesModule, QuestionnaireModule, AdminModule],
  controllers: [DiscoveryController, AdminMatchingController],
  providers: [
    MatchingConfigService, FeaturesService, RecommendationsService, AdaptiveService, SwipesService, DiscoveryService, MatchingAdminService,
    {
      provide: SEARCH_INDEX,
      inject: [APP_CONFIG, DATABASE],
      useFactory: (cfg: AppConfig, db: Database) => (cfg.OPENSEARCH_URL ? new OpenSearchIndex(cfg.OPENSEARCH_URL, cfg.OPENSEARCH_INDEX, cfg.OPENSEARCH_AUTH) : new PostgresSearchIndex(db)),
    },
  ],
  exports: [MatchingConfigService, FeaturesService, RecommendationsService, SwipesService, AdaptiveService],
})
export class MatchingModule {}
