/**
 * Starts the in-process collector on long-running servers (`pnpm dev`,
 * `pnpm start`, a VPS…). On serverless hosts set AUTO_INGEST_MINUTES=0 (the
 * default on Vercel) and call /api/ingest from an external cron instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startAutoIngest } = await import("./lib/ingest/auto");
  startAutoIngest();
}
