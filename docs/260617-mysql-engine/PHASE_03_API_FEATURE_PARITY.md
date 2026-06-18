# Phase 03: API Feature Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this phase task-by-task.

**Goal:** Complete MySQL DDL, metadata, filters, arbitrary queries, result typing, and EXPLAIN
behavior without adding feature-service engine branches.

**Depends on:** Phase 02.

**Exit criteria:** API-side MySQL workflows have parity with PostgreSQL and all engine-specific
policy remains inside drivers or descriptors.

---

## Task 03.01: Move DDL validation behind the active driver

**Source plan task:** 9

**Files:**

- Modify shared DDL types and exports
- Modify DDL service, controller, and tests
- Create `apps/api/src/ddl/dto/ddl-preview.dto.ts`
- Modify the driver interface and all three drivers
- Modify SQL builders and tests for PostgreSQL, SQLite, and MySQL

**Work:**

1. Add and export:

```ts
export type DdlPreviewRequest =
  | { kind: 'createTable'; request: CreateTableRequest }
  | { kind: 'alterTable'; request: AlterTableRequest }
  | { kind: 'createIndex'; request: CreateIndexRequest }
  | { kind: 'dropIndex'; request: DropIndexRequest };

export interface DdlPreviewResult {
  sql: string;
}
```

2. Prove `DdlService` contains no PostgreSQL type, default, cast, or index-method policy.
3. Delegate create-table, alter-table, and index normalization to the active driver.
4. Add authenticated, read-only-guarded `POST /connections/:id/ddl/preview`.
5. Validate the request `kind` union with `ddl-preview.dto.ts`.
6. Use the same normalize/build path as execution without calling `pool.run` or
   `withTransaction`.
7. Support MySQL safe types/defaults, `AUTO_INCREMENT`, BTREE-only indexes, and `MODIFY COLUMN`.
8. Preserve unchanged MySQL type, nullability, default, and auto-increment attributes.
9. Map duplicate, missing, and invalid MySQL DDL errors to existing 409/422 behavior.
10. Run:

```bash
rtk pnpm --filter @prost/api test -- ddl
rtk pnpm --filter @prost/api typecheck
```

11. Commit:

```bash
git add packages/shared-types apps/api/src/ddl apps/api/src/database/db-driver.interface.ts apps/api/src/database/drivers
git commit -m "refactor(api): make DDL validation engine-owned"
```

## Task 03.02: Complete MySQL metadata, filters, queries, result typing, and EXPLAIN

**Source plan task:** 10

**Files:**

- Modify metadata service and tests
- Modify grid filter implementation and tests
- Modify query service and tests
- Modify query editability implementation and tests
- Modify MySQL driver and tests

**Work:**

1. Parse MySQL metadata aliases without service-level engine checks.
2. Add MySQL type families to filter validation.
3. Use MySQL collation-driven `LIKE`.
4. Generate `IN (?, ...)` and `NOT IN (?, ...)`, including empty-list behavior.
5. Parse arbitrary SQL using the descriptor's MySQL parser dialect.
6. Resolve unqualified tables from the saved connection database at runtime.
7. Complete numeric mysql2 type-code mapping for integer, decimal, text, binary, temporal, JSON,
   and unknown codes.
8. Keep code-to-name mapping solely in `describeResultColumns`.
9. Render MySQL EXPLAIN through `driver.formatExplain`; do not change the PostgreSQL path.
10. Preserve splitting, paging, truncation, editability, autocommit, and transactional behavior.
11. Run:

```bash
rtk pnpm --filter @prost/api test -- metadata filter query editability
rtk pnpm --filter @prost/api typecheck
```

12. Commit:

```bash
git add apps/api/src/metadata apps/api/src/grid apps/api/src/query apps/api/src/database
git commit -m "feat(api): add MySQL metadata and query parity"
```

