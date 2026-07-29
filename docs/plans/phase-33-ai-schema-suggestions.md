# Prost — Phase 33: AI Schema-Change Suggestions

## Context

Prost can execute DDL through a disciplined **generate → preview → confirm → execute** pipeline
(`DdlModule`, Phases 8–9) and visualize query plans (Phase 26). This phase lets the AI assistant
**propose schema changes** — most usefully **index recommendations** derived from a slow/`EXPLAIN`'d
query, plus nullability/default/type hints — and route them into that **existing DDL pipeline**.
The assistant never applies DDL itself: it produces a candidate change that lands in the DDL preview,
where the user confirms and the server executes exactly as with a hand-authored change.

This is the capstone of the AI track: it composes Phase 26 (a plan to reason about) and Phase 31 (the
bounded loop), and inherits every DDL guardrail already built. It never auto-applies (principle §8),
never sends row data to the model (principle §3), and — like all DDL — is blocked on read-only
connections (Phase 25). It depends on Phases 26 and 31.

Roadmap item: Phase 33 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (confirmed)

1. **Suggestions are grounded in schema + plan, never row data (principles §1, §3).** The assistant
   reasons from `RetrievalService.describeTables` (columns, foreign keys, and **existing indexes** —
   richer after Phases 23/24) and, for index advice, a `QueryPlanResult` (Phase 26) — an `EXPLAIN` the
   user ran. No credentials, bound values, or result rows enter the prompt (Decision-1 posture). The
   plan is **sanitized before the prompt**: `planText` and each node's `fields` are dropped entirely,
   and `detail` survives only with its literals redacted, because PG writes real values into it
   (`Filter: (email = 'ada@example.com')`).
2. **Every suggestion is a DDL candidate for the existing pipeline (principles §2, §4, §8).** The
   assistant emits a structured change (a `CreateIndexRequest`/`AlterTableRequest` shape from
   `@prost/shared-types`), which is fed into `DdlModule`'s **existing** generate→preview→confirm→
   execute flow — same SQL preview, same `useConfirm` danger gate, same server-side validation via
   the driver's `normalize*`/`build*` builders. The model **never** produces raw SQL that executes;
   it produces a request the server compiles and the user approves.
3. **Server re-validates the candidate, never trusts the model (principle §4).** Each candidate is
   run through `DdlService.preview`, which checks identifiers against live metadata and the type
   allow-list exactly as it does for a hand-authored change. A candidate that fails is **dropped**, so
   a hallucinated column never reaches the UI; the execute path re-validates regardless (422).
4. **Blocked on read-only, executed only on confirm (principles §4, §8).** Because these are writes,
   `PoolManager.assertWritable` rejects them (403) on `readOnly` connections **before any provider
   call** — no LLM spend on a request that can't be applied. Applying still requires the user to
   confirm through the DDL modal. No auto-apply, ever.
5. **Advice is explainable and bounded (principle §11).** Each suggestion carries a rationale ("this
   query seq-scans `orders.user_id`; an index would…") tied to the plan/metadata it came from, so the
   user can judge it. Suggestions are capped at 3 per request; the assistant is instructed to return
   `[]` rather than guess.

## Backend (`apps/api`)

### `AiModule` + `DdlModule`
- `AiModule` imports `DdlModule` (which already exports `DdlService`); no cycle, since `DdlModule`
  doesn't depend on AI.
- `AiService.suggestSchemaChanges(userId, connectionId, req, correlationId)`:
  `resolveEndpoint` → `assertWritable` → resolve tables → `describeTables` → JSON-only prompt →
  `parseSchemaSuggestions` (allow-list) → `DdlService.preview` per candidate (validation + SQL).
- Pure helpers, unit-tested independently and exported for that purpose:
  `sanitizePlanForPrompt`, `resolveTablesFromSql`, `parseSchemaSuggestions`.
- `POST :id/ai/schema-suggest` on `AiController`, `@HttpCode(200)`, same throttle triplet as its
  `chat` / `chart-suggest` / `run-read-query` siblings. **No new DDL execution route.**

### The allow-list
`SUGGESTABLE_ALTER_OPS` in `@prost/shared-types` (`addColumn`, `setNotNull`, `setDefault`,
`changeType`) plus `SchemaSuggestionChange` (`createIndex` | `alterTable`) is the single source of
truth — the server validates against it and the frontend switches on it (principle §6). Every
destructive kind (`dropColumn`, `dropIndex`, `dropForeignKey`, `dropTable`, `truncateTable`) and
`createTable`/`addForeignKey` are structurally unrepresentable in a suggestion.

### Tests (Vitest, `apps/api`)
`ai.service.test.ts` — a suggestion is emitted as a typed request (not raw SQL) and flows through the
existing DDL preview; each destructive kind is dropped at the allow-list without ever being previewed;
a hallucinated column is dropped when preview rejects it, with the valid sibling surviving and nothing
executed; a read-only connection → `ForbiddenException` **and** the provider was never called; the
prompt contains no `planText`, no `fields`, and no plan literals; the count is capped; provider
failure → 503. Plus unit tests for the three pure helpers.

## Frontend (`apps/web`)

### `ddlStore` → `DdlSuggestionHost` → the existing modals
- `stores/ddlStore.ts` — a one-shot `pending` hand-off (`openDdl`/`closeDdl`), not persisted, the same
  seam `aiStore.pendingChatPrompt` uses for "Fix with AI".
- `ddl/DdlSuggestionHost.tsx` — mounted once in `AppLayout` in **both** shells (like `CommandPalette`),
  so mobile parity is free (principle §9) and a suggestion is reviewable without the table's structure
  tab being open. It loads the table structure and routes the change to the right modal.
- `CreateIndexModal` / `AddColumnModal` / `EditColumnModal` gained **optional** `initial*` props and a
  seed-on-open effect (keyed on the serialized initials, the `useDdlPreview` idiom). Their existing
  call sites in `TableStructurePanel` / `Sidebar` / `MobileExplorerView` are untouched, and everything
  downstream — preview, mutations, confirm gates — is unchanged.

### `SchemaSuggestionList` + `useSchemaSuggestions`
A shared card list (rationale + the server-generated SQL + "Review change") and a shared
request/hold/error hook that borrows the chat's model selection from `aiStore`, as Phase 29's chart
suggestion does. Used by all three entry points, each hidden on read-only connections (the "hide"
idiom used by the other DDL actions; the server refuses them there regardless):

1. **Query plan** — "Suggest indexes" in `QueryPlanView`'s toolbar, wired from `SqlEditorView` with
   the plan and the statement it came from; results render in the view's footer.
2. **Table structure** — "Suggest improvements" in `TableStructurePanel`, scoped to that table.
3. **Chat** — "Suggest indexes" beside "Run (read-only)" / "Load into editor" on any ```` ```sql ````
   block in `ChatPanel`; cards render under the block. No stream parsing, no new tool.

### Tests (Vitest, `apps/web` — per Phase 12)
`ddlStore`, `DdlSuggestionHost` (routing + prop wiring per change kind, and that it waits for the
structure), `SchemaSuggestionList` (rationale/SQL render; "Review change" hands off to the store and
executes nothing), the three modals' `initial*` seeding (asserted through the `useDdlPreview` body),
`QueryPlanView`'s suggest action, `TableStructurePanel`'s read-only gate, and `ChatPanel`'s per-block
button (present, sends that block's SQL, hidden on read-only while "Run (read-only)" remains).

## Verification

### Manual (demo target DBs + an LLM endpoint)
1. `EXPLAIN` a query that seq-scans a filtered column (Phase 26) → "Suggest indexes" → a
   `CREATE INDEX` candidate with a rationale.
2. "Review change" → `CreateIndexModal` opens pre-filled; the SQL preview matches; confirm → the index
   is created; re-`EXPLAIN` shows it used.
3. Ask on a `prod`/`readOnly` connection → the entry points are hidden in UI and the endpoint 403s.
4. Coax an invalid suggestion (nonexistent column) → it's dropped; nothing runs.
5. Confirm no row data was included in the suggestion request (logs/prompt inspection).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Auto-applying any schema change without the user's DDL-preview confirmation (never — principle §8).
- Data migrations / backfills as suggestions (schema-shape changes only).
- Stored-procedure/trigger generation (editing those stays frozen — §13).
- Continuous/background index advising over query workload (interactive, per-request only — §13).
