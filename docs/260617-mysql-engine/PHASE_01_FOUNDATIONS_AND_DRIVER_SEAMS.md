# Phase 01: Foundations and Driver Seams

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this phase task-by-task.

**Goal:** Establish engine-neutral contracts and migrate the existing PostgreSQL/SQLite seam before
introducing MySQL.

**Depends on:** None.

**Exit criteria:** Shared types, engine descriptors, connection validation, transaction semantics,
metadata defaults, DDL normalization, type resolution, and EXPLAIN formatting are engine-owned.
The API test suite and typecheck pass without a MySQL driver.

---

## Task 01.01: Expand shared engine and column contracts

**Source plan task:** 1

**Files:**

- Modify `packages/shared-types/src/connection.ts`
- Modify `packages/shared-types/src/metadata.ts`
- Modify `packages/shared-types/src/ddl.ts`
- Modify `packages/shared-types/src/index.ts`
- Modify tests and fixtures constructing `ConnectionDto`, `ColumnMetadata`, or `NewColumn`

**Work:**

1. Add `'mysql'` to `DbEngine`.
2. Add `DbEngineDescriptor` with the exact shape from the source plan.
3. Add `autoIncrement` and `defaultValue` to `ColumnMetadata`.
4. Add optional `autoIncrement` to `NewColumn`.
5. Remove `engine` from the shared update DTO.
6. Run `rtk pnpm -w typecheck` and update every affected fixture explicitly.
7. Run `rtk pnpm -w test`.
8. Commit:

```bash
git add packages/shared-types apps
git commit -m "feat: define MySQL engine and column capabilities"
```

## Task 01.02: Add registry-backed engine descriptors

**Source plan task:** 2

**Files:**

- Modify `apps/api/src/database/db-driver.interface.ts`
- Modify `apps/api/src/database/db-driver.registry.ts`
- Create `apps/api/src/database/database-engines.controller.ts`
- Create `apps/api/src/database/database-engines.controller.test.ts`
- Modify `apps/api/src/database/database.module.ts`
- Modify `apps/api/src/database/drivers/pg/pg-driver.ts`
- Modify `apps/api/src/database/drivers/sqlite/sqlite-driver.ts`

**Work:**

1. Write registry tests for descriptor enumeration, deterministic ordering, and duplicate-engine rejection.
2. Add PostgreSQL and SQLite descriptors.
3. Add `DbDriverRegistry.listDescriptors()`.
4. Reject duplicate driver registrations during registry construction.
5. Add authenticated `GET /database-engines`.
6. Verify descriptors never expose credentials or environment values.
7. Run:

```bash
rtk pnpm --filter @prost/api test -- database-engines db-driver
rtk pnpm --filter @prost/api typecheck
```

8. Commit:

```bash
git add apps/api/src/database
git commit -m "feat(api): expose registered database engines"
```

## Task 01.03: Enforce engine validation and immutability

**Source plan task:** 3

**Files:**

- Modify `apps/api/src/connections/dto/create-connection.dto.ts`
- Modify `apps/api/src/connections/dto/update-connection.dto.ts`
- Modify `apps/api/src/connections/dto/test-connection.dto.ts`
- Modify `apps/api/src/connections/connections.service.ts`
- Modify `apps/api/src/connections/connections.service.test.ts`

**Work:**

1. Test that MySQL connections can be created and tested.
2. Test that unknown engines are rejected before persistence or connection attempts.
3. Test that update requests cannot change the saved engine.
4. Replace static `@IsIn` engine lists with `DbDriverRegistry` validation.
5. Preserve the stored engine when editing or testing an existing connection.
6. Run:

```bash
rtk pnpm --filter @prost/api test -- connections
rtk pnpm --filter @prost/api typecheck
```

7. Commit:

```bash
git add apps/api/src/connections
git commit -m "feat(api): validate and lock connection engines"
```

## Task 01.04: Migrate insert/update execution and split session/transaction pinning

**Source plan task:** 4

This is an atomic task. Change the `DbDriver` interface, all existing implementations, and all
callers in one passing commit.

**Files:**

- Modify `apps/api/src/database/types.ts`
- Modify `apps/api/src/database/db-driver.interface.ts`
- Modify `apps/api/src/database/pool-manager.service.ts`
- Modify `apps/api/src/database/pool-manager.service.test.ts`
- Modify PostgreSQL and SQLite drivers
- Modify `apps/api/src/grid/grid.service.ts` and tests
- Modify `apps/api/src/query/query.service.ts` and tests
- Modify `apps/api/src/database/testing/driver-contract.ts`

**Work:**

1. Add `lastInsertId?: string | number` to `DriverResult`.
2. Rename each driver's pin-only `withTransaction` to `withSession`.
3. Add real driver and pool-manager `withTransaction` methods that issue `BEGIN`, `COMMIT`, and
   `ROLLBACK` on throw.
4. Keep `QueryService.executeTransactional` on `withSession`, preserving its existing explicit
   transaction statements, statement count, COMMIT row, and error attribution.
5. Replace `buildInsertRow` and `buildUpdateRow` with executing `insertRow` and `updateRow`.
6. Implement PostgreSQL/SQLite mutation methods with one `RETURNING *` query.
7. Make `updateRow` throw `NotFoundException` when exactly one row is not returned.
8. Run grid inserts/updates through `PoolManager.withTransaction`.
9. Keep delete, select, count, and other operations as pure SQL fragment builders.
10. Extend the shared driver contract for persisted-row returns and rollback-on-throw.
11. Run:

```bash
rtk pnpm --filter @prost/api test
rtk pnpm --filter @prost/api typecheck
```

12. Commit:

```bash
git add apps/api/src/database apps/api/src/grid apps/api/src/query
git commit -m "refactor(api): executing insert/update + session/transaction split"
```

## Task 01.05: Move metadata defaults, DDL normalization, and EXPLAIN behind PG/SQLite drivers

**Source plan task:** 5

**Files:**

- Modify PostgreSQL and SQLite driver, SQL-builder, and SQL-builder test files
- Modify `apps/api/src/database/db-driver.interface.ts`
- Modify `apps/api/src/database/testing/driver-contract.ts`
- Modify metadata and query services and tests

**Work:**

1. Populate `ColumnMetadata.defaultValue` and `ColumnMetadata.autoIncrement`.
2. Detect PostgreSQL identity columns and `nextval(...)` sequence defaults.
3. Detect SQLite auto-increment only when reliable; otherwise report `false`.
4. Replace `buildResolveTypeNames` with async `describeResultColumns`.
5. Add driver methods `normalizeCreateTable`, `normalizeAlterTable`, and `normalizeCreateIndex`.
6. Add `formatExplain` and route QueryService EXPLAIN formatting through the driver.
7. Assert PostgreSQL and SQLite output remains byte-for-byte compatible.
8. Run:

```bash
rtk pnpm --filter @prost/api test -- pg-sql sqlite-sql driver.contract metadata query
rtk pnpm --filter @prost/api typecheck
```

9. Commit:

```bash
git add apps/api/src/database apps/api/src/metadata apps/api/src/query
git commit -m "refactor(api): driver-owned metadata defaults, DDL normalization, type resolution"
```

