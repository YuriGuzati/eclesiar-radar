import type { NextConfig } from "next";

/** Set by scripts/cf.mjs when building the Cloudflare Workers bundle. */
const onCloudflare = process.env.NEXT_ON_CLOUDFLARE === "1";

const nextConfig: NextConfig = {
  // Cache Components / PPR stay off: the Cloudflare adapter (OpenNext) doesn't
  // fully support them yet, and the app doesn't need them — pages are client
  // shells and every data route is dynamic.

  // Locally, PGlite ships WASM + data files that must be loaded from
  // node_modules at runtime. On Cloudflare both drivers are swapped for a stub
  // (the Worker uses Neon over HTTP), which keeps them out of the bundle.
  serverExternalPackages: onCloudflare ? [] : ["@electric-sql/pglite", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    ...(onCloudflare
      ? {
          resolveAlias: {
            "@electric-sql/pglite": "./lib/db/unavailable.ts",
            postgres: "./lib/db/unavailable.ts",
          },
        }
      : {}),
  },
};

export default nextConfig;
