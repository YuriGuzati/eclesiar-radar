/** Pure SQL helpers (no D1 dependency, unit-tested). */

export interface Stmt {
  sql: string;
  params?: unknown[];
}

/** D1 accepts at most 100 bound parameters per statement. */
export const MAX_PARAMS = 100;

/**
 * Multi-row insert split into statements of at most MAX_PARAMS parameters.
 * The statements are meant to go into one batch, so the split costs no extra
 * queries against D1's per-invocation limit.
 */
export function insertStatements(head: string, tail: string, rows: unknown[][]): Stmt[] {
  if (rows.length === 0) return [];
  const cols = rows[0].length;
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / cols));
  const tuple = `(${Array(cols).fill("?").join(",")})`;
  const out: Stmt[] = [];
  for (let i = 0; i < rows.length; i += perStmt) {
    const part = rows.slice(i, i + perStmt);
    out.push({ sql: `${head} values ${part.map(() => tuple).join(",")} ${tail}`.trim(), params: part.flat() });
  }
  return out;
}

/** `(?,?),(?,?)…` for row-value `IN` lists, e.g. `(item_id, country_id) in (values …)`. */
export function valuesList(rows: number, cols: number): string {
  const tuple = `(${Array(cols).fill("?").join(",")})`;
  return Array(rows).fill(tuple).join(",");
}

export const nowSec = () => Math.floor(Date.now() / 1000);

/** UTC calendar day, e.g. "2026-11-20" (the API's daily quota resets daily). */
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
