import { env } from "@/lib/env";
import { trackUsage } from "@/lib/usage";
import { mockTransport } from "./mock";

export type Params = Record<string, string | number | undefined | null>;

export class EclesiarError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "EclesiarError";
  }
}

/** 429: either the per-account daily quota or the per-IP throttle. Callers should stop, not retry. */
export class RateLimitError extends EclesiarError {
  constructor(path: string, readonly retryAfterSec: number | null) {
    super("Eclesiar API rate limit reached (429)", 429, path);
    this.name = "RateLimitError";
  }
}

function buildUrl(path: string, params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const q = qs.toString();
  return `${env.apiBase}${path}${q ? `?${q}` : ""}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls one Eclesiar endpoint and returns its `data` payload (undefined when the
 * API omitted it, which it does for empty results). In demo mode the request is
 * answered by the synthetic transport and never leaves the process.
 */
export async function call(path: string, params: Params = {}, opts: { auth?: boolean } = {}): Promise<unknown> {
  const auth = opts.auth ?? true;
  if (env.demo) return mockTransport(path, params);

  const url = buildUrl(path, params);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(600);
    let res: Response;
    try {
      if (auth) trackUsage(1);
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "eclesiar-radar/0.1 (+fan-made dashboard)",
          ...(auth ? { Authorization: `Bearer ${env.apiKey}` } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      lastErr = err; // network error / timeout: retry once
      continue;
    }

    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      throw new RateLimitError(path, Number.isFinite(ra) ? ra : null);
    }
    if (res.status >= 500) {
      lastErr = new EclesiarError(`Upstream ${res.status}`, res.status, path);
      continue;
    }

    let body: { code?: number; description?: string; message?: string; data?: unknown };
    try {
      body = await res.json();
    } catch {
      throw new EclesiarError(`Non-JSON response (${res.status})`, res.status, path);
    }
    if (!res.ok || (body.code !== undefined && body.code !== 200)) {
      const msg = body.message || body.description || `HTTP ${res.status}`;
      throw new EclesiarError(msg, body.code ?? res.status, path);
    }
    return body.data;
  }
  throw lastErr instanceof Error ? lastErr : new EclesiarError("Request failed", 0, path);
}
