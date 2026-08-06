import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import {
  pgBuildListTopStatements,
  pgBuildPerfInsightsStatus,
  pgBuildPerfInsightsWindow,
} from './pg/pg-sql';
import {
  mysqlBuildListTopStatements,
  mysqlBuildPerfInsightsStatus,
  mysqlBuildPerfInsightsWindow,
} from './mysql/mysql-sql';
import { PgDriver } from './pg/pg-driver';
import { MysqlDriver } from './mysql/mysql-driver';
import { SqliteDriver } from './sqlite/sqlite-driver';

const config = { get: () => undefined } as unknown as ConfigService;

describe('performance insight builders — PostgreSQL', () => {
  it('checks extension and preload state without referencing the optional view', () => {
    const fragment = pgBuildPerfInsightsStatus();
    expect(fragment.sql).toContain('pg_extension');
    expect(fragment.sql).toContain('shared_preload_libraries');
    expect(fragment.sql).not.toContain('FROM pg_stat_statements');
    expect(fragment.params).toEqual([]);
  });

  it('binds the limit, filters the current database, and handles PG 12/13 timing names', () => {
    const fragment = pgBuildListTopStatements(100);
    expect(fragment.params).toEqual([100]);
    expect(fragment.sql).toContain('LIMIT $1');
    expect(fragment.sql).toContain('current_database()');
    expect(fragment.sql).toContain("to_jsonb(s)->>'total_exec_time'");
    expect(fragment.sql).toContain("to_jsonb(s)->>'total_time'");
    expect(fragment.sql).toContain('GROUP BY query');
  });

  it('reads the exact reset time from the optional pg_stat_statements info view', () => {
    const fragment = pgBuildPerfInsightsWindow();
    expect(fragment.sql).toContain('pg_stat_statements_info');
    expect(fragment.sql).toContain('stats_reset AS statistics_since');
    expect(fragment.params).toEqual([]);
  });
});

describe('performance insight builders — MySQL', () => {
  it('checks Performance Schema and the statements_digest consumer', () => {
    const fragment = mysqlBuildPerfInsightsStatus();
    expect(fragment.sql).toContain('@@performance_schema');
    expect(fragment.sql).toContain("NAME = 'statements_digest'");
    expect(fragment.params).toEqual([]);
  });

  it('uses normalized digest text, converts picoseconds, and never selects a literal sample', () => {
    const fragment = mysqlBuildListTopStatements(100);
    expect(fragment.params).toEqual([100]);
    expect(fragment.sql).toContain('DIGEST_TEXT AS query');
    expect(fragment.sql).toContain('SCHEMA_NAME = DATABASE()');
    expect(fragment.sql).toContain('/ 1000000000');
    expect(fragment.sql).toContain('SUM(SUM_ROWS_SENT + SUM_ROWS_AFFECTED) AS `rows`');
    expect(fragment.sql).not.toContain('QUERY_SAMPLE_TEXT');
    expect(fragment.sql).toContain('LIMIT ?');
  });

  it('uses the earliest retained digest as an approximate statistics-window start', () => {
    const fragment = mysqlBuildPerfInsightsWindow();
    expect(fragment.sql).toContain('MIN(FIRST_SEEN) AS statistics_since');
    expect(fragment.sql).toContain('SCHEMA_NAME = DATABASE()');
    expect(fragment.params).toEqual([]);
  });
});

describe('performance insight capability and error classification', () => {
  it('advertises PostgreSQL/MySQL support and hides SQLite', () => {
    expect(new PgDriver(config).descriptor.supportsPerfInsights).toBe(true);
    expect(new MysqlDriver(config).descriptor.supportsPerfInsights).toBe(true);
    expect(new SqliteDriver(config).descriptor.supportsPerfInsights).toBe(false);
  });

  it('classifies engine permission/setup failures without swallowing unknown errors', () => {
    const pg = new PgDriver(config);
    const mysql = new MysqlDriver(config);
    expect(pg.classifyPerfInsightsError({ code: '42501' })?.reason).toBe('permission_denied');
    expect(pg.classifyPerfInsightsError({ code: '55000' })?.reason).toBe('collection_disabled');
    expect(mysql.classifyPerfInsightsError({ errno: 1142 })?.reason).toBe('permission_denied');
    expect(mysql.classifyPerfInsightsError(new Error('network'))).toBeNull();
  });
});
