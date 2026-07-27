import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { pgBuildKillSession, pgBuildListSessions } from './pg/pg-sql';
import { mysqlBuildBlockingPairs, mysqlBuildKillSession, mysqlBuildListSessions } from './mysql/mysql-sql';

describe('session builders — PostgreSQL', () => {
  it('lists sessions from pg_stat_activity with inline blocked-by, no params', () => {
    const frag = pgBuildListSessions();
    expect(frag.sql).toContain('pg_stat_activity');
    expect(frag.sql).toContain('pg_blocking_pids(pid) AS blocked_by');
    expect(frag.sql).toContain('pid <> pg_backend_pid()');
    expect(frag.params).toEqual([]);
  });

  it('binds the pid and picks the verb per mode', () => {
    expect(pgBuildKillSession(123, 'cancel')).toEqual({ sql: 'SELECT pg_cancel_backend($1)', params: [123] });
    expect(pgBuildKillSession(123, 'terminate')).toEqual({ sql: 'SELECT pg_terminate_backend($1)', params: [123] });
  });
});

describe('session builders — MySQL', () => {
  it('lists sessions from PROCESSLIST excluding self', () => {
    const frag = mysqlBuildListSessions();
    expect(frag.sql).toContain('information_schema.PROCESSLIST');
    expect(frag.sql).toContain('`ID` <> CONNECTION_ID()');
    expect(frag.params).toEqual([]);
  });

  it('reads blocker pairs from performance_schema lock-waits', () => {
    expect(mysqlBuildBlockingPairs().sql).toContain('performance_schema.data_lock_waits');
  });

  it('inlines the validated integer pid and picks the verb per mode (KILL is not preparable)', () => {
    expect(mysqlBuildKillSession(45, 'cancel')).toEqual({ sql: 'KILL QUERY 45', params: [] });
    expect(mysqlBuildKillSession(45, 'terminate')).toEqual({ sql: 'KILL CONNECTION 45', params: [] });
  });

  it('rejects a non-integer session id rather than interpolating it', () => {
    expect(() => mysqlBuildKillSession(Number('7; DROP TABLE users'), 'cancel')).toThrow(UnprocessableEntityException);
    expect(() => mysqlBuildKillSession(-1, 'cancel')).toThrow(UnprocessableEntityException);
  });
});
