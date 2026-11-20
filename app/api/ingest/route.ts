import { env } from "@/lib/env";
import { intParam, route } from "@/lib/http";
import { runIngest } from "@/lib/ingest/run";

export const maxDuration = 60;

/**
 * Collector trigger, called by the Worker's cron (cloudflare-worker.js) or by
 * hand. Requires `Authorization: Bearer <INGEST_SECRET>`; without a secret
 * configured it only answers in development. Optional `?budget=N` overrides
 * the per-run request budget (max 5000) — on Workers Free keep it under ~45,
 * the per-invocation subrequest limit.
 */
const handler = route(async (req) => {
  const secret = env.ingestSecret;
  const auth = req.headers.get("authorization") ?? "";
  const allowed = secret ? auth === `Bearer ${secret}` : !env.isProd;
  if (!allowed) throw Object.assign(new Error("unauthorized"), { status: 401 });

  const budget = intParam(new URL(req.url), "budget");
  return runIngest({ budget: budget != null ? Math.min(Math.max(budget, 0), 5000) : undefined });
});

export const GET = handler;
export const POST = handler;
