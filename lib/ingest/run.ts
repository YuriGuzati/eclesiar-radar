import { env } from "@/lib/env";
import { db, insertStatements, nowSec as currentSec, valuesList, type Db, type Stmt } from "@/lib/db";
import * as api from "@/lib/eclesiar/endpoints";
import { RateLimitError } from "@/lib/eclesiar/client";
import { takeUsageStatement, usageToday } from "@/lib/usage";
import { midRate, normalizeCoinTop, toGold } from "@/lib/domain/fx";
import { buildSpecs, pickTasks, type RefCountry, type TaskSpec, type TaskState } from "./scheduler";
import { backfillDemo } from "./demo-backfill";
import { buildSnapshots, SNAPSHOT_EVERY_SEC } from "./snapshots";

const DAY = 86_400;
/** A market sample is written when the best ask changes, or at least this often. */
const SAMPLE_MAX_AGE_SEC = 3 * 3600;
/** Retention per table, pruned once a day (deletes count as D1 writes too). */
const RETENTION_SEC = { market_samples: 30 * DAY, fx_samples: 60 * DAY, index_samples: 60 * DAY, ingest_runs: 7 * DAY } as const;
const PRUNE_EVERY_SEC = DAY;
/**
 * Consumables (boosters, permits, tanks…) and misc items never show up on the
 * national item markets (checked live), so they aren't worth a request each.
 */
const NON_MARKET_TYPES = new Set(["CONSUMABLE", "ETC"]);
const isMarketItem = (i: { type: string; negotiable: boolean | null }) =>
  i.negotiable !== false && !NON_MARKET_TYPES.has(i.type.toUpperCase());
const GOLD_CURRENCY_ID = 1;

export interface IngestResult {
  ok: boolean;
  skipped?: string;
  aborted?: string;
  requests: number;
  tasks: number;
  errors: number;
  durationMs: number;
}

interface PrevMarket {
  best_local: number | null;
  sampled_at: number;
}

interface Ctx {
  now: number;
  countries: Map<number, { currencyId: number | null }>;
  fx: Map<number, number>;
  prevMarkets: Map<string, PrevMarket>;
  writes: {
    fxSamples: unknown[][];
    fxLatest: unknown[][];
    marketLatest: unknown[][];
    marketSamples: unknown[][];
    regions: unknown[][];
  };
}

interface TaskOutcome {
  calls: number;
  empty: boolean;
}

type StoredState = Record<string, [number, number, number]>;

const g = globalThis as unknown as { __eclesiarIngestRunning?: boolean };

/**
 * One collector pass: spends up to `budget` upstream requests on the most
 * overdue tasks (see scheduler.ts), stores what changed, and every ~10 minutes
 * rebuilds the per-item index and the snapshots the pages read.
 *
 * D1-friendly by design: all writes go into a single batch (one query against
 * the per-invocation limit), and unchanged prices aren't re-sampled.
 */
export async function runIngest(opts: { budget?: number } = {}): Promise<IngestResult> {
  const started = Date.now();
  if (g.__eclesiarIngestRunning) {
    return { ok: false, skipped: "already running", requests: 0, tasks: 0, errors: 0, durationMs: 0 };
  }
  g.__eclesiarIngestRunning = true;
  try {
    return await doRun(opts.budget, started);
  } finally {
    g.__eclesiarIngestRunning = false;
  }
}

async function doRun(requestedBudget: number | undefined, started: number): Promise<IngestResult> {
  const d = await db();
  if (env.demo) await backfillDemo(d);

  let budget = Math.max(0, requestedBudget ?? env.ingestBudget);
  if (env.demo) {
    budget = Math.max(budget, 5000); // synthetic data costs nothing
  } else {
    const left = env.dailyLimit - (await usageToday());
    if (left <= 0) {
      return { ok: false, skipped: "daily request limit reached", requests: 0, tasks: 0, errors: 0, durationMs: Date.now() - started };
    }
    budget = Math.min(budget, left);
  }

  const now = currentSec();
  const meta = await loadMeta(d);
  const states = meta.states;
  const updates = new Map<string, TaskState>();
  let calls = 0;
  let tasks = 0;
  let errors = 0;
  let aborted: string | undefined;

  const ctx: Ctx = {
    now,
    countries: new Map(),
    fx: await loadFx(d),
    prevMarkets: new Map(),
    writes: { fxSamples: [], fxLatest: [], marketLatest: [], marketSamples: [], regions: [] },
  };

  const execute = async (spec: TaskSpec, refWrites?: Stmt[]) => {
    if (aborted) return;
    const prev = states.get(spec.key);
    try {
      const out = await runTask(ctx, spec, refWrites);
      calls += out.calls;
      tasks++;
      updates.set(spec.key, { lastRun: now, emptyStreak: out.empty ? (prev?.emptyStreak ?? 0) + 1 : 0, failStreak: 0 });
    } catch (err) {
      calls += 1;
      if (err instanceof RateLimitError) {
        aborted = "rate limited (429)";
        return;
      }
      errors++;
      updates.set(spec.key, { lastRun: now, emptyStreak: prev?.emptyStreak ?? 0, failStreak: (prev?.failStreak ?? 0) + 1 });
      console.warn(`[ingest] ${spec.key} failed:`, err instanceof Error ? err.message : err);
    }
  };

  // Phase 1 — reference data (countries, items, stats) when due; written right
  // away because phase 2 reads it back.
  const refWrites: Stmt[] = [];
  for (const spec of pickTasks(buildSpecs([], []), states, now, budget)) await execute(spec, refWrites);
  if (refWrites.length) await d.batch(refWrites);

  // Phase 2 — currency books first (item prices are converted with them), then item books, then regions.
  if (!aborted) {
    const refs = await loadRefs(d);
    refs.countries.forEach((c) => ctx.countries.set(c.id, { currencyId: c.currencyId }));
    const specs = buildSpecs(refs.countries, refs.itemIds).filter((s) => s.priority > 0);
    const picked = pickTasks(specs, states, now, Math.max(0, budget - calls));
    ctx.prevMarkets = await loadPrevMarkets(d, picked.filter((s) => s.kind === "market"));
    for (const priority of [1, 2, 3]) {
      if (aborted) break;
      await pool(picked.filter((s) => s.priority === priority), env.concurrency, execute);
    }
  }

  // Everything below goes to D1 as a single batch.
  const pruneDue = now - meta.lastPrune >= PRUNE_EVERY_SEC;
  const writes: Stmt[] = [
    ...dataWrites(ctx),
    stateWrite(states, updates),
    ...(pruneDue ? pruneWrites(now) : []),
    {
      sql: `insert into ingest_runs (id, started_at, finished_at, requests, tasks, errors, note) values (?, ?, ?, ?, ?, ?, ?)`,
      params: [started, Math.floor(started / 1000), currentSec(), env.demo ? 0 : calls, tasks, errors, aborted ?? (env.demo ? "demo" : null)],
    },
  ];
  const usage = takeUsageStatement();
  if (usage) writes.push(usage);
  await d.batch(writes);

  // Rebuild the snapshots when due, right away once the first prices arrive,
  // and after a large manual sweep.
  const marketsWritten = ctx.writes.marketLatest.length;
  if (now - meta.lastSnapshot >= SNAPSHOT_EVERY_SEC || (marketsWritten > 0 && meta.snapshotQuotes === 0) || marketsWritten >= 200) {
    await buildSnapshots(d, now);
  }

  return { ok: !aborted, aborted, requests: calls, tasks, errors, durationMs: Date.now() - started };
}

// ---------------------------------------------------------------- tasks

async function runTask(ctx: Ctx, spec: TaskSpec, refWrites?: Stmt[]): Promise<TaskOutcome> {
  const { now } = ctx;
  switch (spec.kind) {
    case "countries": {
      const rows = await api.getCountries();
      refWrites?.push(
        ...insertStatements(
          `insert into countries (id, name, avatar, currency_id, currency_name, import_tax, vat, work_tax, min_wage, is_available, updated_at)`,
          `on conflict (id) do update set name = excluded.name, avatar = excluded.avatar, currency_id = excluded.currency_id,
             currency_name = excluded.currency_name, import_tax = excluded.import_tax, vat = excluded.vat, work_tax = excluded.work_tax,
             min_wage = excluded.min_wage, is_available = excluded.is_available, updated_at = excluded.updated_at`,
          rows.map((c) => [
            c.id, c.name, c.avatar, c.currency?.id ?? null, c.currency?.name ?? null,
            c.laws?.import_taxes ?? null, c.laws?.vat ?? null, c.laws?.work_tax ?? null, c.laws?.minimum_wage ?? null,
            c.is_available ?? null, now,
          ]),
        ),
      );
      return { calls: 1, empty: rows.length === 0 };
    }
    case "items": {
      const { items, pages } = await api.getItems();
      refWrites?.push(
        ...insertStatements(
          `insert into items (id, name, type, quality, avatar, tradable, updated_at)`,
          `on conflict (id) do update set name = excluded.name, type = excluded.type, quality = excluded.quality,
             avatar = excluded.avatar, tradable = excluded.tradable, updated_at = excluded.updated_at`,
          items.map((i) => [i.id, i.name, i.type, i.quality, i.avatar, isMarketItem(i), now]),
        ),
      );
      return { calls: pages, empty: items.length === 0 };
    }
    case "stats": {
      const rows = await api.getCountryStat("activecitizens");
      // One UPDATE per chunk of countries (params: 2 per country, max 100).
      for (let i = 0; i < rows.length; i += 50) {
        const part = rows.slice(i, i + 50);
        refWrites?.push({
          sql: `with v(id, n) as (values ${valuesList(part.length, 2)})
                update countries set active_citizens = (select n from v where v.id = countries.id)
                where id in (select id from v)`,
          params: part.flatMap((r) => [r.countryId, Math.round(r.value)]),
        });
      }
      return { calls: 1, empty: rows.length === 0 };
    }
    case "regions": {
      const rows = await api.getRegions(spec.countryId!);
      for (const r of rows) ctx.writes.regions.push([r.id, r.name, r.country_id ?? spec.countryId!, now]);
      return { calls: 1, empty: rows.length === 0 };
    }
    case "fx": {
      const cur = spec.currencyId!;
      const [buy, sell] = await Promise.all([api.getCoinOffers(cur, "BUY"), api.getCoinOffers(cur, "SELL")]);
      // Both stored as local currency per 1 Gold (see lib/domain/fx.ts).
      const { buy: buyRate, sell: sellRate } = normalizeCoinTop(buy[0]?.rate, sell[0]?.rate);
      const empty = buy.length === 0 && sell.length === 0;
      if (!empty) {
        const mid = midRate(buyRate, sellRate);
        if (mid) ctx.fx.set(cur, mid);
        else ctx.fx.delete(cur); // no trustworthy price: don't convert this currency
        ctx.writes.fxSamples.push([cur, now, buyRate, sellRate]);
        ctx.writes.fxLatest.push([cur, now, buyRate, sellRate, sum(buy.map((o) => o.amount)), sum(sell.map((o) => o.amount))]);
      }
      return { calls: 2, empty };
    }
    case "market": {
      const countryId = spec.countryId!;
      const itemId = spec.itemId!;
      const prev = ctx.prevMarkets.get(`${itemId}:${countryId}`);
      const offers = await api.getItemOffers(countryId, itemId, 1);
      const currencyId = offers[0]?.currency?.id ?? ctx.countries.get(countryId)?.currencyId ?? null;
      if (offers.length === 0) {
        ctx.writes.marketLatest.push([itemId, countryId, now, currencyId, null, 0, 0, "[]", prev?.sampled_at ?? 0]);
        return { calls: 1, empty: true };
      }
      const best = offers.reduce((a, b) => (b.value < a.value ? b : a));
      const depth = Math.round(sum(offers.map((o) => o.amount)));
      const book = offers.slice(0, 25).map((o) => ({ p: o.value, a: o.amount, s: o.owner?.name ?? null, sc: o.owner?.country_id ?? null, tx: o.import_tax?.rate ?? null }));
      // Sample when the best ask moved, or the last sample is getting old.
      const sampleDue = !prev || prev.best_local !== best.value || now - prev.sampled_at >= SAMPLE_MAX_AGE_SEC;
      if (sampleDue) {
        const rate = currencyId === GOLD_CURRENCY_ID ? 1 : currencyId != null ? ctx.fx.get(currencyId) : undefined;
        ctx.writes.marketSamples.push([itemId, countryId, now, best.value, toGold(best.value, rate), depth, offers.length]);
      }
      ctx.writes.marketLatest.push([itemId, countryId, now, currencyId, best.value, depth, offers.length, JSON.stringify(book), sampleDue ? now : prev!.sampled_at]);
      return { calls: 1, empty: false };
    }
  }
}

// ---------------------------------------------------------------- persistence

function dataWrites(ctx: Ctx): Stmt[] {
  const w = ctx.writes;
  return [
    ...insertStatements(`insert into fx_samples (currency_id, ts, buy_rate, sell_rate)`, `on conflict do nothing`, w.fxSamples),
    ...insertStatements(
      `insert into fx_latest (currency_id, ts, buy_rate, sell_rate, buy_depth, sell_depth)`,
      `on conflict (currency_id) do update set ts = excluded.ts, buy_rate = excluded.buy_rate, sell_rate = excluded.sell_rate,
         buy_depth = excluded.buy_depth, sell_depth = excluded.sell_depth`,
      w.fxLatest,
    ),
    ...insertStatements(
      `insert into market_samples (item_id, country_id, ts, best_local, best_gold, depth, offers)`,
      `on conflict do nothing`,
      w.marketSamples,
    ),
    ...insertStatements(
      `insert into market_latest (item_id, country_id, ts, currency_id, best_local, depth, offers, book, sampled_at)`,
      `on conflict (item_id, country_id) do update set ts = excluded.ts, currency_id = excluded.currency_id, best_local = excluded.best_local,
         depth = excluded.depth, offers = excluded.offers, book = excluded.book, sampled_at = excluded.sampled_at`,
      w.marketLatest,
    ),
    ...insertStatements(
      `insert into regions (id, name, country_id, updated_at)`,
      `on conflict (id) do update set name = excluded.name, country_id = excluded.country_id, updated_at = excluded.updated_at`,
      w.regions,
    ),
  ];
}

const metaUpsert = (key: string, value: string): Stmt => ({
  sql: `insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value`,
  params: [key, value],
});

/** The whole scheduler state lives in one JSON row: one write per run instead of one per task. */
function stateWrite(states: Map<string, TaskState>, updates: Map<string, TaskState>): Stmt {
  const merged: StoredState = {};
  for (const [k, s] of states) merged[k] = [s.lastRun, s.emptyStreak, s.failStreak];
  for (const [k, s] of updates) merged[k] = [s.lastRun, s.emptyStreak, s.failStreak];
  return metaUpsert("scheduler", JSON.stringify(merged));
}

function pruneWrites(now: number): Stmt[] {
  return [
    ...Object.entries(RETENTION_SEC).map(([table, keep]) => ({
      sql: `delete from ${table} where ${table === "ingest_runs" ? "started_at" : "ts"} < ?`,
      params: [now - keep],
    })),
    metaUpsert("last_prune", String(now)),
  ];
}

async function loadMeta(d: Db): Promise<{ states: Map<string, TaskState>; lastPrune: number; lastSnapshot: number; snapshotQuotes: number }> {
  const rows = await d.all<{ key: string; value: string }>(
    `select key, value from meta where key in ('scheduler', 'last_prune', 'last_snapshot', 'snapshot_quotes')`,
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const states = new Map<string, TaskState>();
  try {
    const stored = JSON.parse(get("scheduler") ?? "{}") as StoredState;
    for (const [k, [lastRun, emptyStreak, failStreak]] of Object.entries(stored)) states.set(k, { lastRun, emptyStreak, failStreak });
  } catch {
    // corrupted state: start over, every task is simply due
  }
  return {
    states,
    lastPrune: Number(get("last_prune") ?? 0),
    lastSnapshot: Number(get("last_snapshot") ?? 0),
    snapshotQuotes: Number(get("snapshot_quotes") ?? 0),
  };
}

async function loadFx(d: Db): Promise<Map<number, number>> {
  const rows = await d.all<{ currency_id: number; buy_rate: number | null; sell_rate: number | null }>(
    `select currency_id, buy_rate, sell_rate from fx_latest`,
  );
  const m = new Map<number, number>();
  for (const r of rows) {
    const mid = midRate(r.buy_rate, r.sell_rate);
    if (mid) m.set(r.currency_id, mid);
  }
  return m;
}

async function loadRefs(d: Db): Promise<{ countries: RefCountry[]; itemIds: number[] }> {
  const countries = await d.all<{ id: number; currency_id: number | null }>(
    `select id, currency_id from countries where coalesce(is_available, 1) = 1
     order by active_citizens is null, active_citizens desc, id`,
  );
  const items = await d.all<{ id: number }>(`select id from items where tradable = 1 order by id`);
  return {
    countries: countries.map((c, rank) => ({ id: c.id, currencyId: c.currency_id, rank })),
    itemIds: items.map((i) => i.id),
  };
}

/** Previous best ask + last sample time for the markets about to be read (primary-key lookups only). */
async function loadPrevMarkets(d: Db, specs: TaskSpec[]): Promise<Map<string, PrevMarket>> {
  const out = new Map<string, PrevMarket>();
  for (let i = 0; i < specs.length; i += 50) {
    const part = specs.slice(i, i + 50);
    const rows = await d.all<{ item_id: number; country_id: number; best_local: number | null; sampled_at: number }>(
      `select item_id, country_id, best_local, sampled_at from market_latest
       where (item_id, country_id) in (values ${valuesList(part.length, 2)})`,
      part.flatMap((s) => [s.itemId, s.countryId]),
    );
    for (const r of rows) out.set(`${r.item_id}:${r.country_id}`, { best_local: r.best_local, sampled_at: r.sampled_at });
  }
  return out;
}

// ---------------------------------------------------------------- utils

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
