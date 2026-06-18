# Phase 04: Frontend and AI Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this phase task-by-task.

**Goal:** Make connection setup, DDL controls, SQL formatting, and AI prompts descriptor-driven
and engine-aware.

**Depends on:** Phase 03.

**Exit criteria:** Users can configure and operate MySQL through the web UI without duplicated
MySQL policy in frontend components.

---

## Task 04.01: Add connection URI parsing and MySQL connection UX

**Source plan task:** 11

**Files:**

- Modify `packages/utils/src/parseConnectionString.ts` and tests
- Modify `apps/web/src/connection/ConnectionModal.tsx` and tests
- Modify `apps/web/src/connection/connectionDisplay.ts`
- Create `apps/web/src/api/databaseEngines.ts`

**Work:**

1. Generalize connection-string parsing to return the detected engine.
2. Continue supporting `postgres://` and `postgresql://`.
3. Support `mysql://` with default port `3306`.
4. Map common MySQL `ssl-mode` values to existing SSL fields.
5. Fetch `GET /database-engines` when opening the connection modal.
6. Add an engine picker for new connections.
7. Apply descriptor defaults when the selected engine changes.
8. Include `engine` in create and unsaved-test requests.
9. Hide or disable engine selection for saved connections.
10. Render engine-specific labels and server versions.
11. Preserve PostgreSQL defaults and tests.
12. Run:

```bash
rtk pnpm --filter @prost/utils test
rtk pnpm --filter @prost/web test -- ConnectionModal
rtk pnpm -w typecheck
```

13. Commit:

```bash
git add packages/utils apps/web/src/connection apps/web/src/api/databaseEngines.ts
git commit -m "feat(web): add MySQL connection setup"
```

## Task 04.02: Make DDL modals descriptor-driven

**Source plan task:** 12

**Files:**

- Modify create-table, add-column, edit-column, and create-index modals and tests
- Use `apps/web/src/api/databaseEngines.ts`
- Create `apps/web/src/api/ddlPreview.ts`

**Work:**

1. Replace duplicated PostgreSQL type arrays and default hints with descriptor values.
2. Show `AUTO_INCREMENT` only when advertised.
3. Show `USING` expressions only when advertised.
4. Restrict index methods to descriptor values.
5. Validate required local fields before requesting a preview.
6. Debounce valid preview requests by 300 ms.
7. Cancel or ignore superseded responses and clear previews when forms become invalid.
8. Replace locally generated SQL with the server's `DdlPreviewResult.sql`.
9. Send the matching `DdlPreviewRequest.kind`.
10. Test PostgreSQL and MySQL controls and preview output.
11. Run:

```bash
rtk pnpm --filter @prost/web test -- ddl
rtk pnpm --filter @prost/web build
```

12. Commit:

```bash
git add apps/web/src/ddl apps/web/src/api
git commit -m "feat(web): drive DDL controls from database engines"
```

## Task 04.03: Make editor and AI behavior engine-aware

**Source plan task:** 13

**Files:**

- Modify `apps/web/src/workspace/SqlEditorView.tsx` and tests
- Modify `apps/api/src/ai/ai.service.ts` and tests

**Work:**

1. Select formatter dialect from the active engine descriptor.
2. Preserve Monaco SQL registration and schema completions.
3. Resolve the active engine before constructing AI prompts.
4. Identify MySQL, PostgreSQL, or SQLite correctly in generate, explain, and chat modes.
5. Test formatter selection and prompt text for every engine.
6. Run:

```bash
rtk pnpm --filter @prost/web test -- SqlEditorView
rtk pnpm --filter @prost/api test -- ai.service
rtk pnpm -w typecheck
```

7. Commit:

```bash
git add apps/web/src/workspace apps/api/src/ai
git commit -m "feat: make SQL tooling engine-aware"
```

