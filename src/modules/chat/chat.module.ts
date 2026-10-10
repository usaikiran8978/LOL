import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyCoreModule } from '../safety/safety-core.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, SafetyCoreModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
