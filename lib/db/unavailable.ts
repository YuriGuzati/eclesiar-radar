/**
 * Stand-in for the Node-only database drivers in the Cloudflare build (aliased in
 * next.config.ts when NEXT_ON_CLOUDFLARE=1). On Workers the app talks to Neon over
 * HTTP, so PGlite (WASM + disk) and postgres.js (TCP pool) are never used — this
 * keeps them out of the Worker bundle.
 */
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the Cloudflare Workers build`);
};

export class PGlite {
  constructor() {
    unavailable("PGlite")();
  }
}

export default unavailable("postgres.js");
