import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

@Module({
  imports: [ConnectionsModule],
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
