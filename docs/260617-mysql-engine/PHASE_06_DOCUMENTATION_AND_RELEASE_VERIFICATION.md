# Phase 06: Documentation and Release Verification

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this phase task-by-task.

**Goal:** Document the supported MySQL architecture and prove the complete multi-engine feature is
ready to merge.

**Depends on:** Phase 05.

**Exit criteria:** Documentation is accurate, all automated checks pass, both live contracts run,
and the manual PostgreSQL/MySQL acceptance workflow succeeds.

---

## Task 06.01: Update documentation

**Source plan task:** 16

**Files:**

- Modify `README.md`
- Modify `CLAUDE.md`
- Modify `docs/architecture-principles.md`
- Modify `.env.example`

**Work:**

1. Describe Prost as a multi-engine database client.
2. Document MySQL 8.0+ support and explicit MariaDB exclusion.
3. Document connected-database-only MySQL browsing.
4. Document MySQL URI and TLS behavior.
5. Document executing insert/update methods and deterministic insert-key derivation.
6. State that unsupported insert-key shapes fail with 422 before mutation.
7. Document local MySQL Docker credentials and ports.
8. Search for stale PostgreSQL-only language:

```bash
rtk rg -n "PostgreSQL client|PostgreSQL database|postgres://|5434" README.md CLAUDE.md docs .env.example
```

9. Commit:

```bash
git add README.md CLAUDE.md docs .env.example
git commit -m "docs: document MySQL target support"
```

## Task 06.02: Run final automated verification

**Source plan section:** Final verification

**Work:**

1. Start both live target engines:

```bash
rtk docker compose up -d demo-target-postgres demo-target-mysql
```

2. Confirm both are healthy:

```bash
rtk docker compose ps
```

3. Run all checks:

```bash
rtk pnpm -w build
rtk pnpm -w typecheck
rtk pnpm -w lint
rtk pnpm -w test
```

4. Confirm PostgreSQL and MySQL live contracts executed rather than skipped.

## Task 06.03: Run manual acceptance verification

**Source plan section:** Final verification and acceptance criteria

**Work:**

1. Create and test a MySQL connection.
2. Browse its connected database and confirm sibling databases are hidden.
3. Filter, sort, insert, update, and delete rows.
4. Create and alter a table; create and drop an index.
5. Execute SELECT, DML, DDL, transactions, and EXPLAIN.
6. Format MySQL SQL.
7. Generate an AI response whose prompt identifies MySQL.
8. Repeat the core workflow against PostgreSQL.
9. Confirm no feature service contains an `engine === 'mysql'` branch.
10. Confirm the frontend consumes descriptors instead of duplicating MySQL policy.
11. Confirm mutation rollback leaves no orphan row after forced MySQL re-selection failure.
12. Confirm MariaDB and pre-8.0 MySQL are rejected during test and pool initialization.
13. Confirm MySQL advertises BTREE only.
14. Confirm `withSession` preserves editor transaction behavior and `withTransaction` performs
    real transaction control.
15. Confirm no `DriverOperation`, `executePlan`, or dead `buildResolveTypeNames` abstraction exists.

## Task 06.04: Inspect final repository state

**Work:**

1. Run:

```bash
rtk git status --short
```

2. Confirm only intentional changes remain.
3. Commit any final test-only or documentation corrections separately.

