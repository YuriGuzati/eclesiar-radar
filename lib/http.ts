import { connection } from "next/server";
import { EclesiarError } from "@/lib/eclesiar/client";

/**
 * Wraps a GET/POST handler: opts out of build-time prerendering (every route
 * reads the DB or the upstream API), serialises the result and maps failures
 * to a JSON error instead of an HTML 500.
 */
export function route<T>(fn: (req: Request) => Promise<T>, opts: { maxAgeSec?: number } = {}) {
  return async (req: Request) => {
    await connection();
    try {
      const data = await fn(req);
      return Response.json(data, {
        headers: { "Cache-Control": opts.maxAgeSec ? `public, max-age=0, s-maxage=${opts.maxAgeSec}, stale-while-revalidate=${opts.maxAgeSec * 3}` : "no-store" },
      });
    } catch (err) {
      const own = (err as { status?: unknown } | null)?.status;
      const status = err instanceof EclesiarError ? (err.status === 429 ? 429 : 502) : typeof own === "number" ? own : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[api] ${new URL(req.url).pathname}:`, message);
      return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
    }
  };
}

export function intParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
