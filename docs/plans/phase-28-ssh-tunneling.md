# Prost — Phase 28: SSH Tunneling

## Context

Production databases are rarely reachable directly — they sit behind a bastion/jump host, accessed
over SSH. Today Prost can only connect to databases it can reach on the network, which excludes the
most common real-world prod topology. This phase lets a connection **tunnel through an SSH jump host**
to reach its target DB.

**This requires amending `architecture-principles.md` §13**, which currently freezes SSH tunneling.
The amendment (see [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md) and its dedicated PR) unfreezes
it with one rule: **the tunnel is owned by `PoolManager` and is just another way to reach a target DB
— never a second choke point** (principle §1 preserved). This phase must not land before that
amendment merges.

Roadmap item: Phase 28 in [`roadmap-phase-23-33.md`](./roadmap-phase-23-33.md). Depends on the §13
amendment.

## Decisions (to confirm before building)

1. **The tunnel lives inside the single seam (principle §1).** `PoolManager` establishes the SSH
   tunnel (a local forwarded port) **before** the driver opens its pool, and tears it down when the
   pool is evicted/closed. The driver connects to the local tunnel endpoint exactly as it would to a
   direct host — drivers gain **no SSH awareness**; tunneling is a `PoolManager` concern layered
   under the existing pool lifecycle (Phase 11 idle/LRU reaping tears down the tunnel too).
2. **SSH config is per-connection and encrypted at rest (principle §3).** Add an optional SSH block to
   the connection: `sshHost`, `sshPort` (default 22), `sshUsername`, and an auth secret — a private
   key (with optional passphrase) or a password — **encrypted via the existing `CryptoService`**,
   exactly like the DB credential. It is decrypted only in memory to open the tunnel and is **never**
   returned in any DTO. Non-secret SSH fields (host/port/user) are safe to return.
3. **One contract, additive (principle §6).** `CreateConnectionDto` gains optional SSH input fields;
   `ConnectionDto` exposes only the non-secret ones plus an `sshEnabled` boolean. Absent SSH config =
   today's direct connection (no behavior change for existing connections).
4. **Host-key handling is explicit and safe (principles §3, §11).** The known-host fingerprint is
   captured on first connect and verified thereafter (trust-on-first-use with a visible fingerprint),
   or configured up front; a mismatch fails the connection with a specific error — never a silent
   accept-any-host. Connection failures distinguish SSH-auth vs. tunnel vs. DB-auth errors
   (principle §11).
5. **Tunnels are bounded and observable (principles §11, §12).** Tunnel establish/teardown is logged
   with the correlation id (host + user, **never** the key/password); a tunnel that fails to establish
   surfaces a specific, safe message; tunnels are reaped with their pool so none leak.

## Backend (`apps/api`)

### Prisma + `ConnectionModule`
- Add the SSH fields to the `Connection` model (secret encrypted as `Json` like
  `encryptedCredentials`); extend DTOs (additive, secrets omitted from output). Migrate.
- `testConnection` establishes the tunnel then tests the DB through it, reporting which stage failed.

### `PoolManager` (the seam)
- Before creating a pool for an SSH-enabled connection, establish a forwarded local port via an SSH
  client library; pass the local endpoint to the driver's `createPool`. Track the tunnel handle
  alongside the pool; tear it down on pool close/evict/reap (Phase 11 lifecycle). Enforce a connect
  timeout. Drivers are unchanged.
- Host-key verification (TOFU with stored fingerprint) with a specific mismatch error.

### Tests (Vitest, `apps/api`)
- SSH secret encrypts/decrypts and never appears in a DTO; the pool connects to the tunnel endpoint
  (mocked SSH server) and the tunnel is torn down with the pool; a failed tunnel yields a
  stage-specific error; host-key mismatch is rejected; a non-SSH connection path is unchanged.

## Frontend (`apps/web`)

### Connection form
- `ConnectionModal.tsx`: an "Connect via SSH" toggle revealing `sshHost`/`sshPort`/`sshUsername`, an
  auth-method choice (private key + passphrase, or password), and a key upload/paste. Test Connection
  reports the failing stage (SSH vs. DB). The host-key fingerprint is shown for confirmation on first
  connect. Secrets are write-only (never rendered back), mirroring the DB password. Mobile parity
  (principle §9).

### Tests (Vitest, `apps/web` — per Phase 12)
- The SSH block appears only when enabled; the payload carries the SSH fields; secrets are never
  populated from a fetched `ConnectionDto`; stage-specific test errors render.

## Verification

### Manual (an SSH host forwarding to the demo target Postgres :5434)
1. Create a connection with SSH enabled (key auth) pointing through a jump host at the demo DB → Test
   Connection succeeds; browsing/queries work through the tunnel.
2. Wrong SSH key/password → a specific "SSH authentication failed" error (distinct from DB-auth).
3. Reload → SSH secret is never present in any API response; the connection still works.
4. Leave the connection idle past the pool TTL → logs show tunnel + pool reaped together; reconnect
   re-establishes the tunnel.
5. A host-key change → connection is rejected with a fingerprint-mismatch error.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- SSH agent forwarding / jump-host chains (single hop in v1).
- SSH config-file (`~/.ssh/config`) import.
- Kerberos/GSSAPI or other exotic SSH auth (key + password only).
- Non-SSH tunneling (e.g. cloud IAM proxies) — a separate future slice.
