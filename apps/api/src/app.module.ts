import { MiddlewareConsumer, Module, type NestModule, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { ConnectionsModule } from './connections/connections.module';
import { MetadataModule } from './metadata/metadata.module';
import { GridModule } from './grid/grid.module';
import { QueryModule } from './query/query.module';
import { DdlModule } from './ddl/ddl.module';
import { PreferenceModule } from './preference/preference.module';
import { AiModule } from './ai/ai.module';
import { SnippetModule } from './snippets/snippet.module';

const globalThrottleGuard: Provider = { provide: APP_GUARD, useClass: ThrottlerGuard };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: Number(config.get('THROTTLE_GLOBAL_TTL_MS') ?? 60_000),
          limit: Number(config.get('THROTTLE_GLOBAL_LIMIT') ?? 100),
        },
      ],
    }),
    PrismaModule,
    CommonModule,
    DatabaseModule,
    AuthModule,
    ConnectionsModule,
    MetadataModule,
    GridModule,
    QueryModule,
    DdlModule,
    PreferenceModule,
    AiModule,
    SnippetModule,
  ],
  controllers: [AppController],
  providers: [globalThrottleGuard],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
