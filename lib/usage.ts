import { db, utcDay } from "@/lib/db";

/**
 * Counts authenticated upstream requests against the daily quota.
 * Increments are buffered in memory and written in one statement — the
 * collector flushes at the end of each run, live page reads shortly after.
 */
let pending = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export { utcDay };

export function trackUsage(n: number) {
  pending += n;
  if (!timer) timer = setTimeout(() => void flushUsage(), 1_000);
}

/** Statement that adds the pending count (for callers that batch their writes). */
export function takeUsageStatement() {
  if (pending === 0) return null;
  const n = pending;
  pending = 0;
  return {
    sql: `insert into api_usage (day, requests) values (?, ?)
          on conflict (day) do update set requests = requests + excluded.requests`,
    params: [utcDay(), n],
  };
}

export async function flushUsage(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const stmt = takeUsageStatement();
  if (!stmt) return;
  try {
    await (await db()).batch([stmt]);
  } catch (err) {
    pending += Number(stmt.params[1]); // keep the count; try again on the next flush
    console.error("[usage] flush failed", err);
  }
}

export async function usageToday(): Promise<number> {
  const row = await (await db()).first<{ requests: number }>(`select requests from api_usage where day = ?`, [utcDay()]);
  return Number(row?.requests ?? 0) + pending;
}
