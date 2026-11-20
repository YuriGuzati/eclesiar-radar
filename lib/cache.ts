/**
 * Tiny in-process cache for live (non-persisted) API reads, with request
 * coalescing and stale-while-revalidate: concurrent viewers share one upstream
 * call, and an expired value is served instantly while it refreshes.
 */
interface Entry<T> {
  value?: T;
  has: boolean;
  freshUntil: number;
  staleUntil: number;
  pending?: Promise<T>;
}

const g = globalThis as unknown as { __eclesiarCache?: Map<string, Entry<unknown>> };
const store = (g.__eclesiarCache ??= new Map());

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
        if (cur) cur.pending = undefined;
        if (!cur?.has) store.delete(key);
        throw err;
      });
    const entry = (store.get(key) as Entry<T> | undefined) ?? { has: false, freshUntil: 0, staleUntil: 0 };
    entry.pending = p;
    store.set(key, entry);
    return p;
  };

  if (hit?.has && hit.staleUntil > now) {
    if (!hit.pending) refresh().catch(() => {}); // background refresh; keep serving stale
    return hit.value as T;
  }
  return hit?.pending ?? refresh();
}
