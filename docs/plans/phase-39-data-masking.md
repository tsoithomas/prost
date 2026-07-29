# Prost — Phase 39: Data Masking / Sensitive-Column Redaction

## Context

When a developer shares a screen, exports a table, or demos Prost, sensitive columns (emails, tokens,
PII) are shown in the clear. Prost has no way to mark a column sensitive and have its values redacted.
This phase adds **per-column data masking**: a user marks columns as sensitive, and the **server** redacts
those columns in grid reads **and** exports before the data leaves the seam. It is a safety/ops slice
depending on Phase 30 (export), and it is a **display/export transform — explicitly not access control**
(a single user toggling their own view), so it introduces no RBAC.

Roadmap item: Phase 39 in [`roadmap-phase-34-46.md`](./roadmap-phase-34-46.md). Depends on Phase 30.

## Decisions (to confirm before building)

1. **Masking is enforced server-side, not just hidden (principle §4).** The set of masked columns is
   applied at the read/export path on the server so a masked value never reaches the client or a file —
   the UI hiding is a convenience, the server is the gate. Redaction replaces the value with a token
   (e.g. `••••`), never a partial leak by default.
2. **Sensitivity is an app-DB preference storing identifiers only (principle §1).** Masked columns are a
   per-user, per-connection, per-`table.column` preference (a `maskedColumns` set on `UserPreferenceDto`
   or a small sibling model), storing **identifiers only** — exactly like `columnRenderOverrides`. No
   target row data is persisted.
3. **A display/export transform, not RBAC (principle §13).** The same single user who set the mask can
   **reveal** it (an explicit, per-session, audited reveal action). This is not role-based access control,
   not a security boundary against the user themselves — it is a redaction convenience for sharing/exports.
   Framed as such so it is never mistaken for the frozen "advanced RBAC" item.
4. **A masked column is non-editable while masked (principles §4, §8).** You cannot blind-write over a
   mask token, so a masked cell is read-only in the grid until revealed; editability metadata reflects it.
5. **Exports honor the mask and record it (principles §1, §12).** The Phase-30 export path redacts masked
   columns in CSV/JSON/SQL output; the audit trail (Phase 28) records the export as usual. Masking never
   touches the AI path (which already sends no row data — §3).

## Backend (`apps/api`)

### Read/export redaction + preference
- Add `maskedColumns` to the preference contract (identifiers only) with validation
  (`preference-validation.ts`). Apply redaction in the `GridService` read mapper and the `ExportModule`
  stream so masked columns emit the token; mark masked columns non-editable in the editability metadata.
  A `reveal` is a client-side, per-session state that requests the unmasked read (audited).

### Tests (Vitest, `apps/api`)
- A masked column is redacted in grid reads and in CSV/JSON/SQL export; a masked column is reported
  non-editable; reveal returns the real value and is audited; masking config validates as identifiers only
  (no row data persisted).

## Frontend (`apps/web` + `packages/ui`)

### Mark, mask, reveal
- A "Mark sensitive" toggle in the grid header menu (`ColumnRenderMenu` sibling) and/or the settings
  Connections section; masked cells render the token and are non-editable; a per-session **Reveal** action
  (behind a small confirm) unmasks in the UI. Export dialog notes that masked columns are redacted.

### Tests (Vitest, `apps/web` — per Phase 12)
- Marking a column masks its cells and disables editing; reveal unmasks for the session; the export dialog
  reflects redaction; the setting persists.

## Verification

### Manual (demo target DBs)
1. Mark `users.email` sensitive → its cells show `••••` and are non-editable; export CSV → the column is
   redacted in the file.
2. Reveal → the values show for the session (audited); re-mask hides them again.
3. Confirm server-side enforcement: the masked read/export never contains the real value even if the client
   requests the plain grid.

`pnpm -w build`, `pnpm -w lint`, `pnpm -w test` all pass.

## Out of scope (later phases / explicitly deferred)

- Role-based / multi-user masking or access control (not RBAC — §13).
- Format-preserving or partial masking (e.g. `a***@x.com`) beyond a full token.
- Masking in the AI context (that path already sends no row data — §3).
