// Server-side only (also imported by instrumentation.ts, which is why this
// module doesn't use the `server-only` guard). Never import from client code.

function str(name: string): string {
  return process.env[name]?.trim() || "";
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** True inside Cloudflare Workers (workerd), where there's no disk and no long-lived process. */
export const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

export type Mode = "demo" | "live";

/**
 * Server-side configuration. Nothing here is ever sent to the browser.
 * Without ECLESIAR_API_KEY the app runs in demo mode on synthetic data.
 *
 * Values are read on every access rather than once at import: on Cloudflare
 * Workers the bindings/secrets may only be present on `process.env` once a
 * request is being handled.
 */
export const env = {
  get apiKey() {
    return str("ECLESIAR_API_KEY");
  },
  get apiBase() {
    return (str("ECLESIAR_API_BASE") || "https://api.eclesiar.com").replace(/\/+$/, "");
  },
  get demo() {
    return this.apiKey === "" || process.env.DEMO === "1";
  },
  get mode(): Mode {
    return this.demo ? "demo" : "live";
  },
  get ingestSecret() {
    return str("INGEST_SECRET");
  },
  /**
   * Max upstream requests one ingest run may spend. Sized for the Workers Free
   * plan (50 external subrequests per invocation) with the cron every 2 minutes.
   */
  get ingestBudget() {
    return int("INGEST_BUDGET", 30);
  },
  /** Soft daily cap, kept below the API's hard 50,000/day so live pages still work. */
  get dailyLimit() {
    return int("DAILY_REQUEST_LIMIT", 40_000);
  },
  /**
   * In-process collector interval for `next dev` (0 = off). Always off on
   * Workers, where the cron trigger in wrangler.jsonc drives collection.
   */
  get autoIngestMinutes() {
    return onWorkers ? 0 : int("AUTO_INGEST_MINUTES", 10);
  },
  /** Parallel upstream requests during ingest. */
  get concurrency() {
    return Math.max(1, int("INGEST_CONCURRENCY", 4));
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};
