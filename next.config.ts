import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Cache Components / PPR stay off: the Cloudflare adapter (OpenNext) doesn't
  // fully support them yet, and the app doesn't need them — pages are client
  // shells and every data route is dynamic.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Under `next dev`, exposes the bindings from wrangler.jsonc (the D1 database)
// through a local simulation persisted in .wrangler/state.
if (process.env.NODE_ENV === "development") void initOpenNextCloudflareForDev();

export default nextConfig;
