import { db } from "@/lib/db";

/**
 * Counts authenticated upstream requests against the daily quota.
 * Increments are buffered in memory and flushed to the DB shortly after,
 * so a burst of ingest calls costs one write instead of hundreds.
 */
let pending = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function trackUsage(n: number) {
  pending += n;
  if (!timer) timer = setTimeout(() => void flushUsage(), 1_000);
}

export async function flushUsage(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending === 0) return;
  const n = pending;
  pending = 0;
  try {
    const d = await db();
    await d.query(
      `insert into api_usage (day, requests) values ($1, $2)
       on conflict (day) do update set requests = api_usage.requests + excluded.requests`,
      [utcDay(), n],
    );
  } catch (err) {
    pending += n; // keep the count; try again on the next flush
    console.error("[usage] flush failed", err);
  }
}

export async function usageToday(): Promise<number> {
  const d = await db();
  const rows = await d.query<{ requests: number }>(`select requests from api_usage where day = $1`, [utcDay()]);
  return Number(rows[0]?.requests ?? 0) + pending;
}
