import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [ConnectionsModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
