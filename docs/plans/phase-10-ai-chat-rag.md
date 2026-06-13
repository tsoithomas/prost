# Prost — Phase 10: AI Chat Interface with RAG

## Context

Phases 1–9 give Prost a full manual workflow: connect, browse, view structure, read/edit rows,
run SQL, and (6–9) import connections and manage schema. Phase 10 adds an **AI assistant** — a
chat panel scoped to the active connection that answers questions about the database, and
**generates / explains SQL**, grounded by **retrieval over the connection's schema metadata**
(and optionally query history) so its answers reflect the *actual* database rather than a
guess.

This is the **largest and most novel** backlog item and the first to touch an external model
provider, so it gets its own design pass. Critically, it lands **after** the §13 scope-freeze
was updated ([`../architecture-principles.md`](../architecture-principles.md) §13) to bring AI
features in-scope — explicitly *subject to every other principle*. The security boundaries
below are not optional polish; they're the condition under which this feature is allowed to
exist.

Backlog item: "Chat interface with RAG" in [`../future-features.md`](../future-features.md).
It benefits from Phase 7's richer structure metadata (indexes improve grounding) but is not
blocked by Phases 8/9 — it can proceed as an independent track once Phase 7 lands.

## Decisions (to confirm before building — these gate the design)

1. **No credentials, no row data, no bound values ever leave for the model** (principles §1,
   §3, §12). The retrieval context is built **only** from server-validated *schema metadata*
   (schema/table/column/index names and types — the same data Phases 1/7 already expose) plus,
   optionally, the user's own **SQL text** history (already stored without values/results,
   principle §1). Target-DB **row data and credentials are categorically excluded** from any
   prompt. This is the load-bearing constraint of the whole phase.
2. **The model never gets a database connection.** It proposes SQL as *text*; execution stays on
   the existing, guarded path (`QueryModule` / `GridModule` through `PgConnectionService`) where
   it's parameterized, timed, and editability-analyzed (principle §4). The assistant is a
   suggestion engine; the human (and the existing server rules) decide what runs. **No
   auto-execution of model output in v1.**
3. **Provider access is server-side and configured, never client-side.** A new `AiModule` calls
   the LLM provider using a server-held key from env/config (`AI_API_KEY`, model id) — never
   shipped to the browser, never committed (principle §3). The frontend talks only to our
   backend. Default to a current Claude model per house guidance.
4. **Retrieval v1 is metadata-scoped and bounded**, not a vector store from day one. Start with
   structured retrieval over the active connection's already-cached metadata
   (`MetadataService` / Phase 7 structure): select the schema subset relevant to the question
   and pack it into the prompt within a token budget (principle §7's "bounded, never load
   everything" applied to context). A pgvector-backed embedding index over schema docs is a
   later enhancement, noted in Out of scope.
5. **It's a feature module, cohesive and bounded** (principle §10): `AiModule` owns provider
   integration, retrieval/context assembly, and the chat endpoint. It **depends on**
   `MetadataModule` (and optionally `HistoryModule`) for grounding data; it does **not** reach
   into target DBs itself.
6. **Errors and limits are honest** (principles §11, §13): provider/timeout/rate-limit failures
   surface as specific, safe messages with the correlation id; the feature is gated by config
   so a deployment without `AI_API_KEY` simply doesn't expose it (no half-broken UI). Keep it
   proportionate — chat + grounded SQL suggestions, not an autonomous agent.
7. **New shared types** in `@prost/shared-types` (principle §6): `ChatMessage`
   (`role: 'user' | 'assistant'`, `content`), `ChatRequest` (`connectionId`, `messages`,
   maybe `mode: 'ask' | 'generateSql' | 'explain'`), `ChatResponse` (assistant message + any
   structured `suggestedSql`). Streaming responses are a presentation detail layered on top.

## Backend (`apps/api`)

### `AiModule`

- **`AiProviderService`** — thin wrapper over the LLM SDK; reads `AI_API_KEY` / model id from
  config; exposes a `complete(messages, systemPrompt)` (and a streaming variant). The **only**
  place provider calls happen. Never logs prompt contents that could include user SQL beyond
  what history logging already permits; never logs the key.
- **`RetrievalService`** — given `connectionId` + the user's question, assembles grounding
  context from `MetadataService`/Phase-7 structure (and optional `HistoryModule` SQL text):
  selects relevant schemas/tables, formats a compact schema description, enforces a token
  budget. **Asserts** the context contains only metadata/SQL-text — no row data, no
  credentials (a guard + test, per Decision 1).
- **`AiService.chat(userId, req: ChatRequest)`** — assert connection ownership
  (`connectionsService.assertOwnership`), build the system prompt (role: a Postgres assistant
  for *this* schema; must produce parameterized/safe SQL suggestions and never invent tables
  not in context), call retrieval + provider, return `ChatResponse`.

### `AiController`
- `POST :id/ai/chat` (and/or a streaming `:id/ai/chat/stream`) under the JWT guard, ownership
  asserted like every other connection-scoped route. `ChatDto` (class-validator) matching the
  shared `ChatRequest`. Returns `404`/feature-disabled cleanly when `AI_API_KEY` is unset.

### Tests (Vitest, `apps/api`)
- `retrieval.service.test.ts`: the assembled context for a sample schema includes the right
  table/column/index **names/types** and **excludes** anything resembling row data or
  credentials; token budget is respected. This is the security spine — it encodes Decision 1.
- `ai.service.test.ts`: ownership asserted; provider wrapper is mocked (no network in tests);
  feature-disabled path returns the gated response, not a crash.

## Frontend (`apps/web`)

### Data layer
- `apps/web/src/api/ai.ts` — `useChat(connectionId)` mutation (or a streaming hook) calling the
  backend; conversation state held in a small store or component state. Suggested SQL in a
  `ChatResponse` can be **loaded into Monaco** (reuse the existing `workspaceStore.loadQuery`
  path) — never auto-run (Decision 2).

### Chat UI
- A chat panel in the workspace (and a mobile representation per principle §9): message list
  (user/assistant), input box, streaming-aware rendering. Assistant SQL blocks get a "Load into
  editor" action (→ Monaco) and an "Explain" affordance; **no "Run" that bypasses the existing
  query path** — running still happens in the SQL editor where editability analysis applies.
- Loading/typing indicator, provider-error surfacing with correlation id, and a clear
  "AI is off" state when the feature is unconfigured.
- Token/theming: token-driven styling only (principle §9); no hardcoded colors.

## Verification

### Unit (Vitest, `apps/api`)
Retrieval-context and AI-service tests green (above), provider mocked. Crucially: a test
asserting **no row data / no credentials** can appear in assembled context.

### Manual (demo target DB, port 5434, with `AI_API_KEY` set)
1. Ask "what tables are here?" → answer reflects the real schema (users/orders/products), not a
   hallucinated one.
2. "Write a query for the 5 most recent orders" → returns valid SQL referencing real columns;
   "Load into editor" drops it into Monaco; running it uses the normal (parameterized, timed,
   editability-analyzed) path.
3. "Explain this query" with a pasted statement → a plain-language explanation.
4. Inspect the outbound provider request (server logs/trace): it contains schema metadata only —
   **no passwords, no row values** (Decision 1 holds).
5. Unset `AI_API_KEY` → the UI shows "AI is off"; the endpoint returns the gated response, app
   otherwise unaffected.
6. Provider timeout/rate-limit → specific, safe error with correlation id (principle §11).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- **Auto-executing** model-generated SQL, or letting the model open/query a target DB directly —
  permanently excluded by Decision 2; execution always stays on the guarded human-in-the-loop
  path.
- A pgvector/embedding-backed retrieval index over schema docs (v1 is metadata-scoped,
  in-memory); upgrade retrieval later without changing the boundary.
- Sending any **row data** to the model (e.g. "summarize this result set") — would breach §1/§3
  and is not in scope; revisit only with an explicit, separately-designed data-handling policy.
- Multi-connection / cross-database reasoning, agentic multi-step tool use, fine-tuning, or
  persisting chat transcripts server-side (transcripts are session-scoped in v1).
- Cost/usage dashboards and per-user rate limiting beyond basic provider error handling.
