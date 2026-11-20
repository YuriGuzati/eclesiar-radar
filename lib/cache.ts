import { getCloudflareContext } from "@opennextjs/cloudflare";
import { onWorkers } from "@/lib/env";

/**
 * Tiny in-process cache for live API reads and DB snapshots, with
 * stale-while-revalidate: an expired value is served instantly while it
 * refreshes in the background.
 *
 * On Node, concurrent callers also share one in-flight call. On Workers they
 * don't: a promise created while handling one request must not be awaited by
 * another (the runtime may cancel it once the first response is sent), so each
 * request refreshes on its own and background refreshes go through waitUntil.
 */
interface Entry<T> {
  value?: T;
  has: boolean;
  freshUntil: number;
  staleUntil: number;
  pending?: Promise<T>;
  pendingSince?: number;
}

/** An in-flight refresh older than this is treated as lost. */
const PENDING_TIMEOUT_MS = 30_000;

const g = globalThis as unknown as { __eclesiarCache?: Map<string, Entry<unknown>> };
const store = (g.__eclesiarCache ??= new Map());

function keepAlive(p: Promise<unknown>) {
  p.catch(() => {});
  if (!onWorkers) return;
  try {
    getCloudflareContext().ctx.waitUntil(p);
  } catch {
    // outside a request: nothing to extend
  }
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit?.has && hit.freshUntil > now) return hit.value as T;

  const refresh = () => {
    const p = fn()
      .then((value) => {
        store.set(key, { value, has: true, freshUntil: Date.now() + ttlMs, staleUntil: Date.now() + ttlMs * 5 });
        return value;
      })
      .catch((err) => {
        const cur = store.get(key) as Entry<T> | undefined;
        if (cur?.pending === p) cur.pending = undefined;
        if (!cur?.has) store.delete(key);
        throw err;
      });
    const entry = (store.get(key) as Entry<T> | undefined) ?? { has: false, freshUntil: 0, staleUntil: 0 };
    entry.pending = p;
    entry.pendingSince = Date.now();
    store.set(key, entry);
    return p;
  };
  const inFlight = hit?.pending && now - (hit.pendingSince ?? 0) < PENDING_TIMEOUT_MS ? hit.pending : undefined;

  if (hit?.has && hit.staleUntil > now) {
    if (!inFlight) keepAlive(refresh());
    return hit.value as T;
  }
  return (!onWorkers && inFlight) || refresh();
}
