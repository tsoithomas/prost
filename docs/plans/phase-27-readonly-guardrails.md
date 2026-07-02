# Prost — Phase 27: Read-Only / Environment Connection Guardrails

## Context

Every saved connection is equally writable, and nothing distinguishes a throwaway dev database from
production. A misfired `UPDATE`/`DELETE`/`DROP` against prod is one careless tab away. This phase
adds two per-connection guardrails: an **`environment`** label (`dev`/`staging`/`prod`) and a
**`readOnly`** flag that is **enforced on the server** at the write choke point — not merely hidden
in the UI (principle §4). It also wires `environment` into the **existing per-connection theming**
(`connectionOverrides`, already built in Phase 21) so a prod connection is visually unmistakable.

This is the foundation for safe production use and a dependency of Phase 25 (import) and Phase 31
(agentic AI), both of which must refuse writes on a read-only connection. It depends on nothing.

Roadmap item: Phase 27 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md).

## Decisions (to confirm before building)

1. **Two new fields on `Connection`, one contract (principles §1, §6).** Add `environment`
   (`'dev' | 'staging' | 'prod'`, default `'dev'`) and `readOnly` (boolean, default `false`) to the
   Prisma `Connection` model, `CreateConnectionDto`/`ConnectionDto`, and `ConnectionModal.tsx`.
   Both are non-secret and safe to return to the client. Migrate the app DB.
2. **Read-only is enforced server-side at the choke point (principles §2, §4).** When a connection is
   `readOnly`, the server **rejects any mutating operation** — grid writes (update/insert/delete),
   DDL, and any non-read SQL in the editor — with a specific `403`/`409` (principle §11), before it
   reaches the target DB. Enforcement lives at/near `PoolManager` and the feature-service write
   entrypoints (a single guard), reusing the **editability/statement analyzer** to classify a SQL
   editor statement as read vs. write. The frontend also disables write affordances, but the server
   is the source of truth (the UI is a convenience, not the gate).
3. **Belt-and-suspenders at the session level where cheap.** Where an engine supports it, a read-only
   connection additionally opens sessions in a read-only mode (PostgreSQL
   `default_transaction_read_only = on` / `SET TRANSACTION READ ONLY`; MySQL session read-only where
   available; SQLite open the file read-only). This is defense in depth behind the application-level
   guard, applied by the driver — not a substitute for it.
4. **`environment` drives presentation via existing theming (principle §9).** A connection's
   `environment` maps to the existing `connectionOverrides` accent/mode path (Phase 21) so `prod`
   gets an unmistakable treatment (e.g. a red accent + a "PROD" badge in the top bar / status bar).
   This is pure presentation keyed off the active connection; it never touches target data. A user
   can still customize the override.
5. **Guard classification fails safe (principle §4).** Any statement the analyzer cannot **prove** is
   read-only is treated as a write and blocked on a read-only connection — mirroring the editability
   fail-safe direction settled in Phase 11. "Unknown" means "no."

## Backend (`apps/api`)

### Prisma + `ConnectionModule`
- Add `environment` + `readOnly` to the `Connection` model + DTOs; migrate. `ConnectionService`
  validates `environment` against the enum (specific `400` otherwise).

### Write guard (`PoolManager` / feature services)
- A single `assertWritable(connectionId)` (or equivalent) invoked by every write entrypoint — grid
  update/insert/delete, `DdlService`, and `QueryService` when the analyzer classifies a statement as
  mutating — throwing a specific error on a `readOnly` connection. Reuse the Phase 11 statement
  analyzer for the SQL-editor case (fail safe on doubt).
- Drivers apply the session-level read-only mode (decision 3) when opening pools for a read-only
  connection.

### Tests (Vitest, `apps/api`)
- A read-only connection: grid update/insert/delete → rejected; a `DROP`/`UPDATE` in the editor →
  rejected; a plain `SELECT` → allowed; an ambiguous statement → treated as write/rejected. A
  writable connection is unaffected. `environment` validation → 400 on a bad value. Session-level
  read-only applied per engine.

## Frontend (`apps/web` + `packages/ui`)

### Connection form + indicators
- `ConnectionModal.tsx`: an `environment` selector and a `readOnly` toggle. The top bar / status bar
  shows the active connection's environment badge; `prod` (and `readOnly`) get the strong theming via
  the existing `connectionOverrides`/`applyTheme` path (principle §9), with mobile parity.

### Write-affordance gating
- Disable inline edit / insert / delete / DDL actions on a read-only connection with an explanatory
  tooltip; the SQL editor still runs, but the server rejects writes (surface the specific error).

### Tests (Vitest, `apps/web` — per Phase 12)
- Read-only connection hides/disables write affordances; the environment badge + prod theming apply
  on connection switch and revert on switch-away; a rejected write surfaces the specific message.

## Verification

### Manual (demo target DBs)
1. Mark a connection `readOnly` → inline edit/insert/delete are disabled; running `UPDATE …` in the
   editor is rejected by the server with a clear message; `SELECT` works.
2. Set a connection's `environment` to `prod` → the top/status bar shows a PROD badge and the strong
   accent; switching to a dev connection reverts the theme.
3. Confirm the server rejects a forged write to a read-only connection even with the UI bypassed
   (direct API call) — the gate is server-side.
4. A writable dev connection behaves exactly as before (no regression).

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Per-table or per-operation permissions (connection-level read-only only; fine-grained RBAC stays
  frozen, §13).
- Time-boxed / approval-based write windows for prod.
- Multi-user shared connections (single-user tool — §13).
- Automatic environment inference from host/port (explicit user choice only).
