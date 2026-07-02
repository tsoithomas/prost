# Prost — Roadmap: Phases 23–33 (Post-Backlog Wave)

Phases 0–22 are complete — the MVP, the first post-MVP wave (connection-string import, schema
view/edit, create table, AI chat), and the second wave (reliability hardening, frontend tests, saved
snippets, row filtering, multi-query tabs, multi-statement/`EXPLAIN`, IntelliSense, grid-editing
depth, history management, global search, preferences/theming expansion, streaming results). The
planned backlog in [`../future-features.md`](../future-features.md) is **exhausted**.

This roadmap sequences the **next wave**, chosen from an explicit product steer rather than a
pre-existing backlog:

- **Lead with three tracks:** (A) DBA / power-user depth, (B) production safety & ops, (C) AI depth.
- **Stay a single-user, self-hosted internal tool** — no team/multi-tenant, no new engines.
- **Revisit the §13 scope freeze item-by-item** — amend `architecture-principles.md` first, in a
  dedicated PR, where a feature needs it.

Like [`README.md`](./README.md), this is the *how/when*; [`prost-mvp.md`](./prost-mvp.md) is the
*what* and [`../architecture-principles.md`](../architecture-principles.md) is the *rules*. Each phase
below has its own self-contained `phase-N-*.md` (same format as 0–22) and a row in the README status
table.

## Governance step — §13 amendment (do first)

`architecture-principles.md` §13 currently freezes "SSH tunneling, ER diagrams, stored-procedure/
trigger editors" (among others). This wave needs a **dedicated docs PR** amending §13, with rationale,
per §13's own change rule:

- **Unfreeze SSH tunneling** (Phase 28). New rule: an SSH tunnel is owned by `PoolManager` and is
  merely another way to reach a target DB — it never becomes a second choke point (principle §1
  holds).
- **Clarify read-only schema-object browsing** (Phase 24): *browsing* views/functions/triggers/
  sequences is in scope; only *editing* stored procedures/triggers stays frozen.
- **Note ER diagrams as unfrozen** once FK metadata (Phase 23) exists — an optional, unscheduled
  follow-up.

**Still frozen** (matches the single-user steer): team/multi-tenant, shared connections, advanced
RBAC, SaaS, additional engines (MariaDB, SQL Server, Oracle), background jobs/scheduling, and
stored-procedure/trigger **editing**.

## Phases

| Phase | Scope | Track | Size | Depends on |
| --- | --- | --- | --- | --- |
| [23](./phase-23-foreign-keys.md) | Foreign-key metadata + relational navigation | A · DBA depth | M | — |
| [24](./phase-24-schema-objects.md) | Broader schema-object browsing (views/functions/triggers/…) | A · DBA depth | M | §13 amendment |
| [25](./phase-25-data-export-import.md) | Data export & import (CSV/JSON) | A · DBA depth | L | 27 |
| [26](./phase-26-query-plan-viz.md) | Query-plan visualization | A · DBA depth | M | — |
| [27](./phase-27-readonly-guardrails.md) | Read-only / environment connection guardrails | B · Safety/ops | M | — |
| [28](./phase-28-ssh-tunneling.md) | SSH tunneling | B · Safety/ops | L | §13 amendment |
| [29](./phase-29-session-monitoring.md) | Active-session monitoring & kill-query | B · Safety/ops | M | — |
| [30](./phase-30-audit-trail.md) | Mutation & DDL audit trail | B · Safety/ops | M | — |
| [31](./phase-31-agentic-queries.md) | Agentic read-only query execution | C · AI depth | L | 27 |
| [32](./phase-32-error-insights.md) | Error explanation & result insights | C · AI depth | M | — |
| [33](./phase-33-ai-schema-suggestions.md) | AI schema-change suggestions | C · AI depth | M | 26, 31 |

*(Optional, unscheduled)* **ER diagram** — render FK relationships (Phase 23) as an interactive
diagram; needs the §13 amendment. Flagged as a candidate, not a numbered phase.

## Recommended order & rationale

1. **§13 amendment first.** A short docs PR that unblocks Phase 28 and clarifies Phase 24's read-only
   browsing. Cheap, and the principles doc requires it before the code.
2. **Phase 23 (FK metadata) + Phase 27 (read-only guardrails) — the two foundations.** 23 unlocks
   relational navigation (and, later, ER diagrams); 27 is a hard dependency of Phase 25 (import must
   refuse writes on read-only) and Phase 31 (the agent must refuse writes). They are mutually
   independent and parallelizable.
3. **Independent depth/ops/AI items — Phases 24, 26, 29, 30, 32 — scheduled by appetite.** None block
   each other; each is a self-contained slice with visible payoff (object browsing, plan viz, session
   monitor, audit trail, charts/error-explain).
4. **Phase 25 (export/import) and Phase 31 (agentic) after Phase 27.** Both lean on the read-only
   guard. **Phase 28 (SSH)** after the amendment.
5. **Phase 33 last.** It composes the DDL preview pipeline (via Phase 26's plans as input) and the
   bounded AI loop (Phase 31).

Tracks {A}, {B}, {C} can be resourced in parallel; they converge only on shared types in
`@prost/shared-types`. Suggested pickup grouping: {§13 → 23, 27} first, then {24, 26, 29, 30, 32} in
any order, then {25, 31, 28}, then {33}.

## Invariants carried forward

Every phase stays inside the existing rails: the two-database boundary (§1) — including SSH tunnels,
which live *inside* the `PoolManager` seam, not beside it; parameterized target SQL + `quoteIdent`
(§2); server-decides/frontend-renders (§4) — read-only enforcement, agentic read-only proof, and DDL
re-validation are all server-side; one grid contract (§5) — plan/chart/object views are narrow
siblings, never a forked grid; shared types as the single source of truth (§6); never load more than a
page (§7) — export streams via the Phase 22 cursor, charts use the loaded page, the agent gets a
bounded sample; safe/reversible mutations (§8) — every write and DDL stays behind confirm gates and
never auto-applies; structural theming + mobile-first (§9); honest, observable errors (§11/§12) —
audit records failures, tunnels/sessions/tool-calls are traced by correlation id, no credentials/row
values ever leave the seam. Only §13 is amended, and only for the items listed above. A phase is
"done" only when its verification passes **and** it violates none of these.
