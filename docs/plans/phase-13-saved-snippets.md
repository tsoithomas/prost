# Prost — Phase 13: Saved Snippets

## Context

The Sidebar already has a **"Snippets" tab rendered disabled with a "Soon" badge**
(`Sidebar.tsx`) — the UI affordance was reserved but never wired. This phase delivers named,
reusable SQL snippets per user: save the current editor buffer as a named snippet, list them in
the Sidebar, click to load one back into Monaco. It deliberately **mirrors `HistoryModule`** —
same module shape, same per-user scoping, same click-to-load path (`workspaceStore.loadQuery`) —
so it's a well-trodden pattern, not new infrastructure.

It depends on nothing structural; it benefits from **Phase 12** (ship the new module's UI with
tests). It pairs naturally with the "save current query" backlog entry, which is folded in here as
the save entry point.

Backlog items: "Saved snippets (Sidebar 'Snippets' tab)" and "Save current query → snippet" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **Snippets are app-DB data, Prisma only (principle §1).** A new `Snippet` model in
   `apps/api/prisma/schema.prisma` (`id`, `userId`, `name`, `body` (SQL text), `createdAt`,
   `updatedAt`) — like `QueryHistory`, it stores **only SQL text**, never target rows/values.
2. **Per-user, not per-connection.** A snippet is a reusable query the user owns; it isn't bound
   to one connection (you might run the same snippet against staging and prod). This matches how
   the Sidebar tab sits above the connection context. (Revisit per-connection scoping later if
   asked — noted in Out of scope.)
3. **New shared types in `@prost/shared-types` (principle §6):** `SnippetDto`
   (`id`, `name`, `body`, `createdAt`, `updatedAt`), `CreateSnippetRequest` (`name`, `body`),
   `UpdateSnippetRequest` (`name?`, `body?`). Both sides import these; no hand-redeclaration.
4. **Full CRUD, with a danger gate on delete (principle §8).** Create (save-from-editor), list,
   rename/edit, delete. Delete routes through the shared `useConfirm` danger dialog.
5. **Click-to-load reuses the existing path.** Selecting a snippet calls
   `workspaceStore.loadQuery` (the same path History uses) — never auto-runs (consistent with
   Phase 10 Decision 2 and the History tab).

## Backend (`apps/api`)

### Prisma
- Add the `Snippet` model; `pnpm --filter @prost/api prisma:migrate`. Index on `userId`.

### `SnippetModule` (mirrors `HistoryModule`)
- `SnippetService`: `create(userId, req)`, `list(userId)`, `update(userId, id, req)`,
  `remove(userId, id)` — every method scoped by `userId`; update/remove assert ownership (404 on
  another user's id, principle §3). Name uniqueness per user (or allow dupes — pick one; if
  unique, surface a specific `409`, principle §11).
- `SnippetController` under the JWT guard: `POST /snippets`, `GET /snippets`,
  `PATCH /snippets/:id`, `DELETE /snippets/:id`.

### Tests (Vitest, `apps/api`)
- `snippet.service.test.ts`: CRUD scoped by user; another user's id → 404 on update/delete; list
  returns only the caller's snippets; (if enforced) duplicate name → 409.

## Frontend (`apps/web`)

### Data layer
- `apps/web/src/api/snippets.ts` — `useSnippets`, `useCreateSnippet`, `useUpdateSnippet`,
  `useDeleteSnippet` (TanStack Query, matching `history.ts`/`preferences.ts`), invalidating the
  list on mutation.

### Sidebar "Snippets" tab
- Replace the disabled "Soon" tab with a real `SnippetList`: rename/delete actions per row
  (delete → `useConfirm` danger), click-to-load → `workspaceStore.loadQuery`. Empty state when
  the user has none.
- Mobile: surface in the bottom-sheet menu / Settings, consistent with how History appears on
  mobile (principle §9).

### Save-from-editor
- A "Save snippet" action in the `SqlEditorView` toolbar (next to Run — **not** the slimmed
  TopBar, per the backlog note): prompts for a name, calls `useCreateSnippet` with the current
  buffer.

### Tests (Vitest, `apps/web` — per Phase 12)
- Save-from-editor calls `useCreateSnippet` with the buffer; click-to-load calls `loadQuery`,
  never auto-runs; delete fires the danger confirm before the mutation.

## Verification

### Manual
1. Write a query, "Save snippet", give it a name → it appears in the Sidebar Snippets tab.
2. Click it → loads into Monaco (does not auto-run).
3. Rename it → reflected in the list. Delete it → danger confirm → gone.
4. As a second user, the first user's snippets are not visible; forging another user's id on
   `PATCH`/`DELETE` → 404.
5. Works at ~360px (mobile snippets surface).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Snippet folders/tags, sharing between users, parameterised snippet templates.
- Per-connection snippet scoping (v1 is per-user).
- Importing/exporting snippet collections.
- Snippet search — folds into the global search of Phase 20 if wanted.
