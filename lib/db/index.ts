import { env, onWorkers } from "@/lib/env";
import { SCHEMA, schemaStatements } from "./schema";

export interface Db {
  kind: "pglite" | "postgres" | "neon";
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
}

// One handle per server process / Worker isolate (survives dev hot-reloads).
const g = globalThis as unknown as { __eclesiarDb?: Promise<Db> };

/**
 * Returns the shared database handle, opening and migrating it on first use.
 * - On Cloudflare Workers: Neon's HTTP driver (`DATABASE_URL`). Every query is
 *   a stateless fetch, so the handle can be shared across requests — unlike a
 *   TCP client, which Workers refuse to reuse between requests.
 * - DATABASE_URL elsewhere: real Postgres via postgres.js.
 * - Otherwise: embedded PGlite (WASM Postgres) persisted under .data/.
 *   Demo mode always uses its own PGlite directory so synthetic data never
 *   mixes with real history.
 */
export function db(): Promise<Db> {
  if (!g.__eclesiarDb) {
    g.__eclesiarDb = open().catch((err) => {
      g.__eclesiarDb = undefined;
      throw err;
    });
  }
  return g.__eclesiarDb;
}

async function open(): Promise<Db> {
  const handle = onWorkers ? await openNeon() : env.databaseUrl && !env.demo ? await openPostgres() : await openPglite();
  await handle.exec(SCHEMA);
  console.log(`[db] ${handle.kind} ready`);
  return handle;
}

async function openNeon(): Promise<Db> {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not set. On Cloudflare Workers the app needs a Postgres database (e.g. Neon).");
  }
  if (env.demo) {
    throw new Error("Demo mode only runs locally (it uses the embedded database). Set ECLESIAR_API_KEY on the Worker.");
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(env.databaseUrl);
  return {
    kind: "neon",
    query: async (text, params = []) => (await sql.query(text, params)) as never,
    // HTTP queries take one statement each; send them all in a single transaction round trip.
    exec: async (text) => {
      await sql.transaction(schemaStatements(text).map((s) => sql.query(s)));
    },
  };
}

async function openPostgres(): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.databaseUrl, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
  return {
    kind: "postgres",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (text, params = []) => (await sql.unsafe(text, params as any[])) as never,
    exec: async (text) => {
      await sql.unsafe(text);
    },
  };
}

async function openPglite(): Promise<Db> {
  const [{ PGlite }, path, { mkdir }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("node:path"),
    import("node:fs/promises"),
  ]);
  const dir = path.join(process.cwd(), ".data", env.demo ? "pglite-demo" : "pglite");
  await mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  try {
    await pg.waitReady;
  } catch (err) {
    // Usually a data folder copied or synced while incomplete. It only holds
    // collected samples, so recreating it is safe.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Embedded database at ${dir} could not be opened (${reason}). Stop the server, delete that folder and start again to recreate it.`);
  }
  return {
    kind: "pglite",
    query: async (text, params = []) => (await pg.query(text, params)).rows as never,
    exec: async (text) => {
      await pg.exec(text);
    },
  };
}

/** Builds `($1,$2,..),($n,..)` placeholders for a multi-row insert. */
export function valuesSql(rows: number, cols: number, casts: (string | null)[] = []): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const ph: string[] = [];
    for (let c = 0; c < cols; c++) {
      const cast = casts[c];
      ph.push(`$${r * cols + c + 1}${cast ? `::${cast}` : ""}`);
    }
    out.push(`(${ph.join(",")})`);
  }
  return out.join(",");
}

/** Runs a multi-row insert in chunks so we stay far below Postgres' parameter limit. */
export async function insertMany(
  d: Db,
  head: string,
  tail: string,
  rows: unknown[][],
  casts: (string | null)[] = [],
  chunk = 400,
): Promise<void> {
  if (rows.length === 0) return;
  const cols = rows[0].length;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await d.query(`${head} values ${valuesSql(part.length, cols, casts)} ${tail}`, part.flat());
  }
}
