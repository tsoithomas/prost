const DOLLAR_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export interface StatementRange {
  /** Trimmed statement text. */
  sql: string;
  /** Offset of the first non-whitespace char of the statement in the original string. */
  start: number;
  /** Offset just past the last non-whitespace char of the statement in the original string. */
  end: number;
}

/**
 * Splits a SQL script into top-level statements with character ranges into the original
 * string, respecting string/identifier literals, dollar-quoted bodies, and comments.
 * Mirrors the backend `splitStatements` (apps/api/src/query/statement-splitter.ts) but
 * preserves offsets so the editor can map a cursor position to a single statement.
 * Empty/whitespace-only segments are dropped. Never throws.
 */
export function splitStatementRanges(sql: string): StatementRange[] {
  const ranges: StatementRange[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  const pushSegment = (from: number, to: number) => {
    const raw = sql.slice(from, to);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    ranges.push({ sql: trimmed, start: from + leading, end: from + leading + trimmed.length });
  };

  while (i < n) {
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      const nl = sql.indexOf('\n', i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    if (two === '/*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        const pair = sql.slice(i, i + 2);
        if (pair === '/*') {
          depth++;
          i += 2;
        } else if (pair === '*/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    const ch = sql[i];

    if (ch === "'" || ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '$') {
      const match = DOLLAR_TAG_RE.exec(sql.slice(i));
      if (match) {
        const delimiter = match[0];
        const closeIndex = sql.indexOf(delimiter, i + delimiter.length);
        if (closeIndex !== -1) {
          i = closeIndex + delimiter.length;
          continue;
        }
      }
      i++;
      continue;
    }

    if (ch === ';') {
      pushSegment(start, i);
      start = i + 1;
      i++;
      continue;
    }

    i++;
  }

  pushSegment(start, n);
  return ranges;
}

/**
 * Returns the statement whose range contains `offset`, or — when the cursor sits between
 * or after statements (whitespace, trailing blank lines) — the nearest preceding
 * statement. Returns `null` only when there are no statements at or before the offset.
 */
export function statementAtOffset(sql: string, offset: number): string | null {
  const ranges = splitStatementRanges(sql);
  if (ranges.length === 0) return null;

  let candidate: StatementRange | null = null;
  for (const range of ranges) {
    if (offset >= range.start && offset <= range.end) return range.sql;
    if (range.start <= offset) candidate = range;
    else break;
  }
  // Cursor before the first statement → fall back to the first statement.
  return (candidate ?? ranges[0]!).sql;
}
