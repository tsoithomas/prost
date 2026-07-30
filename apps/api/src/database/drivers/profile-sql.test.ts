import { describe, expect, it } from 'vitest';
import { pgBuildColumnProfile, pgBuildColumnTopValues, pgPlanProfileSample } from './pg/pg-sql';
import { mysqlBuildColumnProfile, mysqlPlanProfileSample } from './mysql/mysql-sql';
import { sqliteBuildColumnProfile, sqliteBuildColumnTopValues, sqlitePlanProfileSample } from './sqlite/sqlite-sql';
import { PROFILE_SAMPLE_TARGET_ROWS } from './profile-sql';

const ref = { namespace: 'public', name: 'users' };
const specs = [
  { name: 'id', orderable: true },
  { name: 'payload', orderable: false },
];

describe('planProfileSample', () => {
  it('never samples a table at or below the target size', () => {
    expect(pgPlanProfileSample(PROFILE_SAMPLE_TARGET_ROWS, false)).toEqual({ kind: 'full' });
    expect(mysqlPlanProfileSample(PROFILE_SAMPLE_TARGET_ROWS, false)).toEqual({ kind: 'full' });
    expect(sqlitePlanProfileSample(0, false)).toEqual({ kind: 'full' });
  });

  it('never samples when the caller asked for exact numbers', () => {
    expect(pgPlanProfileSample(10_000_000, true)).toEqual({ kind: 'full' });
    expect(mysqlPlanProfileSample(10_000_000, true)).toEqual({ kind: 'full' });
  });

  it('Postgres samples randomly, scaling the percentage to the target row count', () => {
    expect(pgPlanProfileSample(1_000_000, false)).toEqual({ kind: 'random', percent: 5 });
    // Clamped into (0, 100] however extreme the estimate.
    const tiny = pgPlanProfileSample(Number.MAX_SAFE_INTEGER, false);
    expect(tiny.kind).toBe('random');
    expect(tiny.kind === 'random' && tiny.percent).toBeGreaterThan(0);
  });

  it('MySQL and SQLite fall back to the first N rows', () => {
    expect(mysqlPlanProfileSample(1_000_000, false)).toEqual({ kind: 'firstRows', limit: PROFILE_SAMPLE_TARGET_ROWS });
    expect(sqlitePlanProfileSample(1_000_000, false)).toEqual({ kind: 'firstRows', limit: PROFILE_SAMPLE_TARGET_ROWS });
  });
});

describe('buildColumnProfile', () => {
  it('emits scanned_rows plus four aliased aggregates per column', () => {
    const { sql } = pgBuildColumnProfile(ref, specs, { kind: 'full' });
    expect(sql).toContain('COUNT(*) AS scanned_rows');
    for (const alias of ['c0_nulls', 'c0_distinct', 'c0_min', 'c0_max', 'c1_nulls', 'c1_distinct', 'c1_min', 'c1_max']) {
      expect(sql).toContain(alias);
    }
  });

  it('skips distinct/min/max for columns the engine cannot compare', () => {
    const { sql } = pgBuildColumnProfile(ref, specs, { kind: 'full' });
    expect(sql).toContain('COUNT(DISTINCT "id")');
    expect(sql).toContain('(MIN("id"))::text AS c0_min');
    // The unorderable column still reports nulls, but its other aggregates are literal NULLs.
    expect(sql).toContain('COUNT(*) - COUNT("payload") AS c1_nulls');
    expect(sql).toContain('NULL AS c1_distinct');
    expect(sql).not.toContain('COUNT(DISTINCT "payload")');
    expect(sql).not.toContain('MIN("payload")');
  });

  it('quotes identifiers rather than interpolating them raw', () => {
    const { sql } = pgBuildColumnProfile({ namespace: 'public', name: 'users' }, [{ name: 'drop me', orderable: true }], {
      kind: 'full',
    });
    expect(sql).toContain('"drop me"');
    expect(sql).toContain('FROM "public"."users"');
  });

  it('applies Postgres TABLESAMPLE for a random plan, with no bound params', () => {
    const { sql, params } = pgBuildColumnProfile(ref, specs, { kind: 'random', percent: 2.5 });
    expect(sql).toContain('FROM "public"."users" TABLESAMPLE SYSTEM (2.5000)');
    expect(params).toEqual([]);
  });

  it('applies a bound LIMIT subquery for a firstRows plan', () => {
    const mysql = mysqlBuildColumnProfile({ namespace: 'app', name: 'users' }, specs, { kind: 'firstRows', limit: 50_000 });
    expect(mysql.sql).toContain('FROM (SELECT * FROM `app`.`users` LIMIT ?) AS profile_sample');
    expect(mysql.sql).not.toContain('50000');
    expect(mysql.params).toEqual([50_000]);

    const sqlite = sqliteBuildColumnProfile({ name: 'users' }, specs, { kind: 'firstRows', limit: 50_000 });
    expect(sqlite.sql).toContain('FROM (SELECT * FROM "users" LIMIT ?) AS profile_sample');
    expect(sqlite.params).toEqual([50_000]);
  });

  it('casts min/max to text per dialect', () => {
    expect(mysqlBuildColumnProfile(ref, specs, { kind: 'full' }).sql).toContain('CAST(MIN(`id`) AS CHAR) AS c0_min');
    expect(sqliteBuildColumnProfile(ref, specs, { kind: 'full' }).sql).toContain('CAST(MIN("id") AS TEXT) AS c0_min');
  });
});

describe('buildColumnTopValues', () => {
  it('groups by the column and binds the limit', () => {
    const { sql, params } = pgBuildColumnTopValues(ref, 'email', { kind: 'full' }, 10);
    expect(sql).toContain('("email")::text AS value');
    expect(sql).toContain('COUNT(*) AS occurrences');
    expect(sql).toContain('GROUP BY "email"');
    expect(sql).toContain('ORDER BY occurrences DESC');
    expect(sql).toContain('LIMIT $1');
    expect(params).toEqual([10]);
  });

  it('numbers the limit placeholder after the sample params', () => {
    const { sql, params } = pgBuildColumnTopValues(ref, 'email', { kind: 'firstRows', limit: 50_000 }, 10);
    expect(sql).toContain('LIMIT $1) AS profile_sample');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([50_000, 10]);
  });

  it('projects only the profiled column into a sampled subquery', () => {
    const { sql } = sqliteBuildColumnTopValues({ name: 'users' }, 'email', { kind: 'firstRows', limit: 100 }, 5);
    expect(sql).toContain('FROM (SELECT "email" FROM "users" LIMIT ?) AS profile_sample');
  });
});
