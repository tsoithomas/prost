# Phase 05: Live Integration and CI

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this phase task-by-task.

**Goal:** Validate MySQL behavior against a real MySQL 8.0 instance locally and make both
PostgreSQL and MySQL contracts mandatory in CI.

**Depends on:** Phase 04.

**Exit criteria:** Shared live contracts pass against PostgreSQL and MySQL, and CI fails when
either required database is unavailable or non-conformant.

---

## Task 05.01: Add live MySQL contract coverage

**Source plan task:** 14

**Files:**

- Create `apps/api/src/database/drivers/mysql/mysql-driver.contract.test.ts`
- Modify `apps/api/src/database/testing/driver-contract.ts`
- Modify `docker-compose.yml`
- Create `docker/demo-target-mysql-init.sql`
- Modify `.env.example`

**Work:**

1. Add `demo-target-mysql` using a pinned MySQL 8.0 image.
2. Mount an initialization script containing `users`, `orders`, and `products`, including an
   `AUTO_INCREMENT` key and a composite key.
3. Expose host port `3307`.
4. Configure database, user, and password as `demo`.
5. Add a `mysqladmin ping` health check.
6. Run the shared driver contract against MySQL.
7. Cover metadata shape, filters, rollback, DDL/error mapping, auto-increment insert,
   primary-key-changing update, type metadata, and EXPLAIN.
8. Keep unreachable live contracts skippable in ordinary local unit runs.
9. Verify:

```bash
rtk docker compose up -d demo-target-postgres demo-target-mysql
rtk pnpm --filter @prost/api test -- driver.contract
```

10. Commit:

```bash
git add docker-compose.yml docker .env.example apps/api/src/database
git commit -m "test(api): run driver contracts against MySQL"
```

## Task 05.02: Require both live engines in CI

**Source plan task:** 15

**Files:**

- Modify `.github/workflows/ci.yml`
- Modify `apps/api/src/database/testing/driver-contract.ts`

**Work:**

1. Add a MySQL 8.0 CI service with a health check.
2. Add `CONTRACT_MYSQL_*` environment values.
3. Set `REQUIRE_LIVE_DRIVER_CONTRACTS=true`.
4. Fail required-live mode if PostgreSQL or MySQL cannot be reached.
5. Preserve local skip behavior when the flag is absent.
6. Validate workflow syntax and run the full local suite.
7. Commit:

```bash
git add .github/workflows/ci.yml apps/api/src/database/testing
git commit -m "ci: require PostgreSQL and MySQL driver contracts"
```

