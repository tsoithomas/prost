import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    // The app DB is SQLite, and a read-only better-sqlite3 handle (the "App Database"
    // self-connection) reads the same file concurrently. WAL lets that reader run without
    // blocking on Prisma's writes; the read-only handle can't set pragmas, so the writer must.
    // These pragmas return a row, so they go through $queryRawUnsafe (not $executeRawUnsafe).
    await this.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
    await this.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
