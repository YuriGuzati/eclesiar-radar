import { env } from "@/lib/env";
import { intParam, route } from "@/lib/http";
import { runIngest } from "@/lib/ingest/run";

export const maxDuration = 60;

/**
 * Collector trigger for external schedulers (cron-job.org, Vercel Cron,
 * GitHub Actions…). Requires `Authorization: Bearer <INGEST_SECRET>`
 * (or Vercel's CRON_SECRET). Without any secret configured it only answers
 * in development. Optional `?budget=N` overrides the per-run request budget
 * (max 5000), e.g. for a first full sweep.
 */
const handler = route(async (req) => {
  const secrets = [env.ingestSecret, process.env.CRON_SECRET?.trim()].filter(Boolean);
  const auth = req.headers.get("authorization") ?? "";
  const allowed = secrets.length > 0 ? secrets.some((s) => auth === `Bearer ${s}`) : !env.isProd;
  if (!allowed) throw Object.assign(new Error("unauthorized"), { status: 401 });

  const budget = intParam(new URL(req.url), "budget");
  return runIngest({ budget: budget != null ? Math.min(Math.max(budget, 0), 5000) : undefined });
});

export const GET = handler;
export const POST = handler;
