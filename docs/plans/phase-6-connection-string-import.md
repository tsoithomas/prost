# Prost — Phase 6: Connection String Import

## Context

Today a connection is created by filling in six separate fields in `ConnectionModal`
(`apps/web/src/connection/ConnectionModal.tsx`): name, host, port, database, username,
password, plus an SSL checkbox. Pasting an existing Postgres URL — the form most credentials
are actually distributed in (`postgres://user:pass@host:5432/db?sslmode=require`) — means
hand-splitting it into those fields.

Phase 6 adds a **"paste a connection string" affordance** that parses a libpq-style URI into
the existing `ConnectionFormState`, then lets the user review/test/save exactly as today. It
is the smallest stage in the backlog: **frontend-only**, no new endpoints, no schema change,
no change to how credentials are stored (the parsed password still flows through the existing
create/encrypt path, principle §3).

This is backlog item "Add connection via connection string" in
[`../future-features.md`](../future-features.md).

## Decisions (to confirm before building)

1. **Parsing lives in `packages/utils`, not in the component.** A pure, framework-free
   `parseConnectionString(input: string)` sits beside `quoteIdent` — it's testable in
   isolation (Vitest, like `quoteIdent.test.ts`) and has no React/DOM dependency. It returns a
   discriminated result (`{ ok: true, value: ParsedConnection } | { ok: false, error: string }`),
   never throws for user input.
2. **Accept the common real-world forms.** `postgres://` and `postgresql://` schemes;
   `user[:password]@host[:port]/database`; percent-encoded credentials (decode them);
   `?sslmode=` query param mapped to the boolean `sslEnabled` (`require`/`verify-ca`/
   `verify-full`/`prefer` → `true`, `disable`/`allow` → `false`). Missing port → default
   `5432`. Missing database → leave blank for the user to fill, not an error.
3. **Parse fills the form; it does not auto-submit.** The result populates the existing fields
   (host/port/database/username/password/SSL) so the user still reviews, tests, and clicks
   Connect/Save through the unchanged flow. The connection **name** is *not* in a URI, so we
   leave it blank (or default it to the database name) for the user to set.
4. **No persistence of the raw string.** The pasted URI — which contains a plaintext password —
   is parsed in memory, written into form state, and discarded. It is never stored, never sent
   to the backend as-is, never logged (principles §1, §3). The existing create path encrypts
   the password as it does for hand-typed input.
5. **The parser is the only new contract.** No `@prost/shared-types` change is needed — the
   parser maps into the local `ConnectionFormState`, which already mirrors
   `CreateConnectionDto`.

## Frontend (`apps/web`) + `packages/utils`

### `packages/utils` — `parseConnectionString`

- New `packages/utils/src/parseConnectionString.ts`, exported from `index.ts` (alongside
  `quoteIdent`). Implement with the platform `URL` parser where possible, then map fields;
  validate the scheme and surface a friendly `error` string for anything unparseable.
- `ParsedConnection` shape: `{ host, port, database, username, password, sslEnabled }` — all
  strings except `port: number` and `sslEnabled: boolean`, matching how the form stores them
  (note the form keeps `port` as a string; the component converts).
- Unit tests (`parseConnectionString.test.ts`) covering: full URI; no password; no port
  (defaults 5432); percent-encoded password (`%40` → `@`); each `sslmode` value; `postgresql://`
  alias; and rejection of non-Postgres/garbage input with a non-throwing error result. This is
  the verification spine of the stage.

### `ConnectionModal.tsx` — paste affordance

- Add an **"Import from connection string"** control in the form header area (a small link/
  button that reveals a single-line input + "Parse" button, or a paste-into textarea). Keep it
  visually subordinate to the real fields — it's a shortcut, not the primary path.
- On parse success: `setForm` from the parsed values (preserving the user-entered `name` if
  any, else default to the parsed database), `testConnection.reset()`, clear `formError`.
- On parse failure: show the parser's `error` via the existing `formError` channel (the
  `role="alert"` paragraph already in the modal) — no new error surface.
- The password reveal/`showPassword`, Test, Save, and Connect buttons all work unchanged on the
  now-populated form.

## Verification

### Unit (Vitest, `packages/utils`)
`parseConnectionString.test.ts` green (cases enumerated above) — every field mapped, defaults
applied, bad input returns `{ ok: false }` without throwing.

### Manual (dev server)
1. Paste `postgresql://admin@localhost:5434/demo?sslmode=disable` → host/port/database/user/SSL
   populate; password blank; test/connect work.
2. Paste a URI with a percent-encoded password → password decodes correctly and a successful
   test confirms it.
3. Paste garbage → friendly inline error, form untouched.
4. Confirm DevTools network/console never shows the raw pasted string leaving the browser, and
   the stored connection still has no password in any `ConnectionDto` response (principle §3,
   unchanged).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Key/value DSN form (`host=... port=... dbname=...`) — only the URI form is parsed here.
- `sslmode` fidelity beyond the boolean `sslEnabled` (cert paths, `verify-full` semantics) —
  the app models SSL as a single boolean today; richer SSL config is its own change.
- Exporting a saved connection *as* a connection string, or any clipboard round-trip.
- Importing multiple connections at once / file import.
