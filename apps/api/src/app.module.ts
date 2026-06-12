import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { AuthModule } from './auth/auth.module';
import { TargetDbModule } from './target-db/target-db.module';
import { ConnectionsModule } from './connections/connections.module';
import { MetadataModule } from './metadata/metadata.module';
import { GridModule } from './grid/grid.module';
import { QueryModule } from './query/query.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    CommonModule,
    TargetDbModule,
    AuthModule,
    ConnectionsModule,
    MetadataModule,
    GridModule,
    QueryModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
