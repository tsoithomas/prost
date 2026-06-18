# Phase 02: MySQL Driver Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this phase task-by-task.

**Goal:** Add pure MySQL SQL generation, a registered MySQL 8.0+ driver, and deterministic atomic
insert/update behavior.

**Depends on:** Phase 01.

**Exit criteria:** MySQL is registered, MariaDB and MySQL versions before 8.0 are rejected at test
and pool initialization, and mutation methods return persisted rows without unsafe inference.

---

## Task 02.01: Add pure MySQL SQL builders

**Source plan task:** 6

**Files:**

- Create `apps/api/src/database/drivers/mysql/mysql-sql.ts`
- Create `apps/api/src/database/drivers/mysql/mysql-sql.test.ts`

**Work:**

1. Write failing tests for backtick quoting, embedded backticks, invalid identifiers, and `?`
   placeholders.
2. Test database-qualified table names using `TableRef.namespace`.
3. Test metadata queries scoped only to the connected database:
   - Parameterless builders use `TABLE_SCHEMA = DATABASE()`.
   - `TableRef` builders use `TABLE_SCHEMA = ?` and `ref.namespace`.
4. Test metadata aliases, primary keys, `AUTO_INCREMENT`, indexes, CRUD, filtering, counts, DDL,
   type helpers, and EXPLAIN normalization.
5. Implement the minimum pure builders needed to pass.
6. Do not store a connection database on the singleton driver.
7. Run:

```bash
rtk pnpm --filter @prost/api test -- mysql-sql
rtk pnpm --filter @prost/api typecheck
```

8. Commit:

```bash
git add apps/api/src/database/drivers/mysql
git commit -m "feat(api): add pure MySQL SQL builders"
```

## Task 02.02: Implement and register `MysqlDriver`

**Source plan task:** 7

**Files:**

- Modify `apps/api/package.json`
- Modify `pnpm-lock.yaml`
- Create `apps/api/src/database/drivers/mysql/mysql-driver.ts`
- Create `apps/api/src/database/drivers/mysql/mysql-driver.test.ts`
- Modify `apps/api/src/database/database.module.ts`

**Work:**

1. Add `mysql2` as an API runtime dependency.
2. Create a `mysql2/promise` pool from existing connection fields.
3. Map SSL, pool size, connect timeout, and query timeout settings.
4. Install credential-safe pool error listeners.
5. Normalize row arrays and result headers into `DriverResult`.
6. Store raw mysql2 numeric type codes in `fields[].dataTypeID`; leave `dataTypeName` undefined.
7. Preserve `insertId` as `lastInsertId`.
8. Implement `withSession` and real `withTransaction`, always releasing the connection.
9. Implement every `DbDriver` method so registration typechecks:
   - `insertRow` and `updateRow`
   - DDL normalization
   - `describeResultColumns`
   - `formatExplain`
10. Add `assertSupportedVersion`; reject MariaDB and MySQL major versions below 8.
11. Enforce the version guard in both `testConnection` and first pool initialization.
12. Advertise only `['btree']` for MySQL index methods.
13. Register the driver in `DatabaseModule`.
14. Run:

```bash
rtk pnpm install
rtk pnpm --filter @prost/api test -- mysql-driver
rtk pnpm --filter @prost/api typecheck
```

15. Commit:

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/database
git commit -m "feat(api): add MySQL database driver"
```

## Task 02.03: Harden MySQL `insertRow` and `updateRow`

**Source plan task:** 8

**Files:**

- Modify MySQL driver and tests
- Modify MySQL SQL builders and tests
- Modify `apps/api/src/database/testing/driver-contract.ts`

**Work:**

1. Validate the insert key before executing `INSERT`.
2. Accept only:
   - A complete supplied primary key.
   - A primary key missing exactly one `AUTO_INCREMENT` component, filled from `insertId`.
3. Reject with 422 before mutation:
   - No primary key.
   - Multiple missing key components.
   - A missing non-auto-increment key component.
   - Default-only inserts.
4. Test complete, auto-increment, and composite primary-key inserts.
5. Re-select the inserted row by the full derived key; never use latest-row ordering or
   non-unique value matching.
6. For updates, re-select using the resulting key, including when the primary key itself changes.
7. Treat same-value updates as successful when re-selection finds the row, regardless of affected
   row count.
8. Throw `NotFoundException` only when update re-selection finds no row.
9. Contract-test rollback when re-selection fails.
10. Run:

```bash
rtk pnpm --filter @prost/api test -- mysql driver-contract
rtk pnpm --filter @prost/api typecheck
```

11. Commit:

```bash
git add apps/api/src/database/drivers/mysql apps/api/src/database/testing
git commit -m "feat(api): return MySQL mutation rows atomically"
```

