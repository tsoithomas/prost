import { Global, Module } from '@nestjs/common';
import { PgConnectionService } from './pg-connection.service';

@Global()
@Module({
  providers: [PgConnectionService],
  exports: [PgConnectionService],
})
export class TargetDbModule {}
