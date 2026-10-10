import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientAnalyticsController, ContentController } from './content.controller';

@Module({ imports: [AuthModule], controllers: [ContentController, ClientAnalyticsController] })
export class ContentModule {}
