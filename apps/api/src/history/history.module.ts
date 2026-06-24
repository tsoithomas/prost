import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { HistoryController, HistoryManagementController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [ConnectionsModule],
  controllers: [HistoryController, HistoryManagementController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
