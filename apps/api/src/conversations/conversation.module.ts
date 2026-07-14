import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [ConnectionsModule],
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
