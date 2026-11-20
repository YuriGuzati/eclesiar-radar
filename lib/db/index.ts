import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "@/lib/env";
import { DATA_TABLES, schemaStatements } from "./schema";
import type { Stmt } from "./sql";

export { insertStatements, valuesList, nowSec, utcDay, MAX_PARAMS, type Stmt } from "./sql";

// Minimal slice of the D1 Worker API we use (avoids pulling in the full workers types).
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] | null }>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface Db {
  kind: "d1";
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /**
   * Runs statements as one transactional batch. On D1 a batch counts as a
   * single query against the per-invocation limit (50 on the Free plan).
   */
  batch(statements: Stmt[]): Promise<void>;
}

/** Statements per batch call (keeps very large demo backfills manageable). */
const BATCH_CHUNK = 200;

const g = globalThis as unknown as { __eclesiarDbReady?: Promise<void> };

/**
 * The Cloudflare D1 database bound as `DB` (wrangler.jsonc). In production it
 * comes from the Worker; under `next dev` OpenNext asks Wrangler for a local D1
 * simulation persisted under `.wrangler/state`.
 */
async function binding(): Promise<D1Database> {
  const { env: bindings } = await getCloudflareContext({ async: true });
  const d1 = (bindings as unknown as { DB?: D1Database }).DB;
  if (!d1) throw new Error("D1 binding `DB` is missing — check d1_databases in wrangler.jsonc.");
  return d1;
}

/** D1 binds numbers, strings and null; normalise the rest. */
function bindable(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  return v;
}

function prepare(d1: D1Database, s: Stmt): D1PreparedStatement {
  const stmt = d1.prepare(s.sql);
  return s.params?.length ? stmt.bind(...s.params.map(bindable)) : stmt;
}

async function runBatch(d1: D1Database, statements: Stmt[]) {
  for (let i = 0; i < statements.length; i += BATCH_CHUNK) {
    await d1.batch(statements.slice(i, i + BATCH_CHUNK).map((s) => prepare(d1, s)));
  }
}

/**
 * Creates the tables once per isolate/process, and wipes collected data when
 * switching between demo and live mode so synthetic data never mixes with real.
 */
async function ensureReady(d1: D1Database): Promise<void> {
  await runBatch(d1, schemaStatements().map((sql) => ({ sql })));
  const row = (await prepare(d1, { sql: "select value from meta where key = 'mode'" }).all<{ value: string }>()).results?.[0];
  if (row?.value !== env.mode) {
    await runBatch(d1, [
      ...DATA_TABLES.map((t) => ({ sql: `delete from ${t}` })),
      { sql: "insert into meta (key, value) values ('mode', ?) on conflict (key) do update set value = excluded.value", params: [env.mode] },
    ]);
    if (row) console.log(`[db] switched from ${row.value} to ${env.mode} data — previous data cleared`);
  }
}

export async function db(): Promise<Db> {
  const d1 = await binding();
  if (!g.__eclesiarDbReady) {
    g.__eclesiarDbReady = ensureReady(d1).catch((err) => {
      g.__eclesiarDbReady = undefined;
      throw err;
    });
  }
  await g.__eclesiarDbReady;
  return {
    kind: "d1",
    all: async <T,>(sql: string, params: unknown[] = []) => ((await prepare(d1, { sql, params }).all<T>()).results ?? []) as T[],
    first: async <T,>(sql: string, params: unknown[] = []) => ((await prepare(d1, { sql, params }).all<T>()).results?.[0] ?? null) as T | null,
    batch: (statements: Stmt[]) => runBatch(d1, statements),
  };
}
