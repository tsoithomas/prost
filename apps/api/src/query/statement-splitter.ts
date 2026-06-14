const DOLLAR_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Splits a SQL script into top-level statements, respecting string/identifier literals,
 * dollar-quoted bodies, and comments. Empty/whitespace-only segments (trailing `;`, blank
 * lines, fully-commented segments) are dropped. Never throws — an unterminated
 * string/comment/dollar-quote is treated as part of the final statement and left for
 * Postgres to report.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

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
      const segment = sql.slice(start, i).trim();
      if (segment.length > 0) statements.push(segment);
      start = i + 1;
      i++;
      continue;
    }

    i++;
  }

  const last = sql.slice(start).trim();
  if (last.length > 0) statements.push(last);
  return statements;
}
