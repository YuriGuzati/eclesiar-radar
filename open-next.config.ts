import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * The app has no ISR: pages are prerendered shells and all data comes from
 * dynamic route handlers, so the read-only static-assets cache is enough and no
 * R2/KV bucket is needed.
 *
 * Next still tries to write route-cache entries at request time; the stock
 * read-only cache logs an ERROR for every one of those writes. This wrapper
 * keeps its reads and ignores writes/deletes quietly.
 */
const quietStaticAssetsCache: typeof staticAssetsIncrementalCache = Object.assign(Object.create(staticAssetsIncrementalCache), {
  async set() {},
  async delete() {},
});

export default defineCloudflareConfig({
  incrementalCache: quietStaticAssetsCache,
});
