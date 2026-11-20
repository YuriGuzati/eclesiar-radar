// Runs the OpenNext Cloudflare CLI with NEXT_ON_CLOUDFLARE=1, which makes
// next.config.ts leave the Node-only database drivers out of the Worker bundle.
// Cross-platform replacement for `NEXT_ON_CLOUDFLARE=1 opennextjs-cloudflare …`.
//
//   node scripts/cf.mjs build | preview | deploy | upload
import { spawnSync } from "node:child_process";

const result = spawnSync("opennextjs-cloudflare", process.argv.slice(2), {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_ON_CLOUDFLARE: "1" },
});
process.exit(result.status ?? 1);
