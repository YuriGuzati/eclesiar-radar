/**
 * Starts the in-process collector under `pnpm dev`. On Cloudflare Workers it
 * stays off: the cron trigger (wrangler.jsonc → cloudflare-worker.js) calls
 * /api/ingest instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startAutoIngest } = await import("./lib/ingest/auto");
  startAutoIngest();
}
