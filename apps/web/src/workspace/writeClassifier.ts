const WRITE_KEYWORDS =
  /^(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|replace|call|comment)\b/i;

/**
 * Best-effort client-side "is this a write?" check for the confirm-writes gate — strips leading
 * comments/whitespace and inspects the first keyword. Advisory only; the server independently enforces
 * read-only connections (Phase 25).
 */
export function isLikelyWrite(sql: string): boolean {
  const stripped = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return WRITE_KEYWORDS.test(stripped);
}
