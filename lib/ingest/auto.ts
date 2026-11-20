import { env } from "@/lib/env";
import { runIngest } from "./run";

const g = globalThis as unknown as { __eclesiarAutoIngest?: ReturnType<typeof setInterval> };

export function startAutoIngest() {
  const minutes = env.autoIngestMinutes;
  if (minutes <= 0 || g.__eclesiarAutoIngest) return;

  const tick = async () => {
    try {
      const r = await runIngest();
      if (r.skipped) console.log(`[ingest] skipped: ${r.skipped}`);
      else console.log(`[ingest] ${env.mode}: ${r.tasks} tasks, ${r.requests} requests, ${r.errors} errors in ${r.durationMs} ms${r.aborted ? ` (${r.aborted})` : ""}`);
    } catch (err) {
      console.error("[ingest] run failed:", err);
    }
  };

  console.log(`[ingest] auto collector every ${minutes} min (${env.mode} mode)`);
  setTimeout(tick, 3_000);
  g.__eclesiarAutoIngest = setInterval(tick, minutes * 60_000);
}
