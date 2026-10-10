import { Global, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAiController, AiController } from './ai.controller';
import { AiFeaturesService } from './ai-features.service';
import { AiGatewayService } from './ai-gateway.service';

@Global()
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [AiController, AdminAiController],
  providers: [AiGatewayService, AiFeaturesService],
  exports: [AiGatewayService, AiFeaturesService],
})
export class AiModule {}
