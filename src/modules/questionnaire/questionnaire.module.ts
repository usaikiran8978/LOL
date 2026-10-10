import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AdminQuestionnaireTaxonomyController, AdminQuestionsController } from './questionnaire-admin.controller';
import { QuestionnaireAdminService } from './questionnaire-admin.service';
import { QuestionnaireController } from './questionnaire.controller';
import { QuestionnaireService } from './questionnaire.service';
import { QuestionRepo } from './question-repo';

@Module({
  imports: [AuthModule, ProfilesModule, AdminModule],
  controllers: [QuestionnaireController, AdminQuestionsController, AdminQuestionnaireTaxonomyController],
  providers: [QuestionRepo, QuestionnaireService, QuestionnaireAdminService],
  exports: [QuestionRepo, QuestionnaireService],
})
export class QuestionnaireModule {}
