import { env } from "@/lib/env";
import { db, insertMany, type Db } from "@/lib/db";
import * as api from "@/lib/eclesiar/endpoints";
import { RateLimitError } from "@/lib/eclesiar/client";
import { flushUsage, usageToday } from "@/lib/usage";
import { midRate, normalizeCoinTop, toGold } from "@/lib/domain/fx";
import { buildSpecs, pickTasks, type RefCountry, type TaskSpec, type TaskState } from "./scheduler";
import { backfillDemo } from "./demo-backfill";

const RETENTION_DAYS = 60;
/** Old samples are pruned at most this often (pruning costs 4 queries). */
const PRUNE_EVERY_SEC = 6 * 3600;
const PRUNE_KEY = "maint:prune";
/**
 * Consumables (boosters, permits, tanks…) and misc items never show up on the
 * national item markets (checked live), so they aren't worth a request each.
 */
const NON_MARKET_TYPES = new Set(["CONSUMABLE", "ETC"]);
const isMarketItem = (i: { type: string; negotiable: boolean | null }) =>
  i.negotiable !== false && !NON_MARKET_TYPES.has(i.type.toUpperCase());
/** Markets older than this are ignored when computing the global index. */
const INDEX_WINDOW_HOURS = 12;
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

interface Ctx {
  d: Db;
  now: Date;
  countries: Map<number, { currencyId: number | null }>;
  fx: Map<number, number>;
  marketSamples: unknown[][];
  marketLatest: unknown[][];
  fxSamples: unknown[][];
  fxLatest: unknown[][];
  regionRows: unknown[][];
}

interface TaskOutcome {
  calls: number;
  empty: boolean;
}

const g = globalThis as unknown as { __eclesiarIngestRunning?: boolean };

/**
 * One collector pass: spends up to `budget` upstream requests on the most
 * overdue tasks (see scheduler.ts), stores the samples and recomputes the
 * per-item global index. Safe to call from a cron route or an in-process timer.
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
    await flushUsage();
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

  const runRow = await d.query<{ id: number }>(`insert into ingest_runs (started_at) values (now()) returning id`);
  const runId = runRow[0].id;
  const nowSec = Math.floor(started / 1000);
  const states = await loadStates(d);
  const updates = new Map<string, TaskState>();
  let calls = 0;
  let tasks = 0;
  let errors = 0;
  let aborted: string | undefined;

  const ctx: Ctx = {
    d,
    now: new Date(started),
    countries: new Map(),
    fx: await loadFx(d),
    marketSamples: [],
    marketLatest: [],
    fxSamples: [],
    fxLatest: [],
    regionRows: [],
  };

  const execute = async (spec: TaskSpec) => {
    if (aborted) return;
    const prev = states.get(spec.key);
    try {
      const out = await runTask(ctx, spec);
      calls += out.calls;
      tasks++;
      updates.set(spec.key, { lastRun: nowSec, emptyStreak: out.empty ? (prev?.emptyStreak ?? 0) + 1 : 0, failStreak: 0 });
    } catch (err) {
      calls += 1;
      if (err instanceof RateLimitError) {
        aborted = "rate limited (429)";
        return;
      }
      errors++;
      updates.set(spec.key, { lastRun: nowSec, emptyStreak: prev?.emptyStreak ?? 0, failStreak: (prev?.failStreak ?? 0) + 1 });
      console.warn(`[ingest] ${spec.key} failed:`, err instanceof Error ? err.message : err);
    }
  };

  // Phase 1 — reference data (countries, items, stats) when due.
  const refSpecs = pickTasks(buildSpecs([], []), states, nowSec, budget);
  for (const spec of refSpecs) await execute(spec);

  // Phase 2 — currency books, then item books, then regions, each as a parallel pool.
  if (!aborted) {
    const refs = await loadRefs(d);
    refs.countries.forEach((c) => ctx.countries.set(c.id, { currencyId: c.currencyId }));
    const specs = buildSpecs(refs.countries, refs.itemIds).filter((s) => s.priority > 0);
    const picked = pickTasks(specs, states, nowSec, Math.max(0, budget - calls));
    // Currency books first (item prices are converted with them), then item books, then regions.
    for (const priority of [1, 2, 3]) {
      if (aborted) break;
      await pool(picked.filter((s) => s.priority === priority), env.concurrency, execute);
    }
  }

  // Writes are batched: on Workers every DB query counts as a subrequest
  // (50 per invocation on the Free plan), so a run issues ~15 queries in total.
  const pruneDue = nowSec - (states.get(PRUNE_KEY)?.lastRun ?? 0) >= PRUNE_EVERY_SEC;
  if (pruneDue) updates.set(PRUNE_KEY, { lastRun: nowSec, emptyStreak: 0, failStreak: 0 });
  await flushRows(ctx);
  await saveStates(d, updates);
  await regold(d, ctx.fx, ctx.countries);
  await computeIndex(d, ctx.now);
  if (pruneDue) await prune(d);

  const durationMs = Date.now() - started;
  await d.query(
    `update ingest_runs set finished_at = now(), requests = $2, tasks = $3, errors = $4, note = $5 where id = $1`,
    [runId, env.demo ? 0 : calls, tasks, errors, aborted ?? (env.demo ? "demo" : null)],
  );
  return { ok: !aborted, aborted, requests: calls, tasks, errors, durationMs };
}

// ---------------------------------------------------------------- tasks

async function runTask(ctx: Ctx, spec: TaskSpec): Promise<TaskOutcome> {
  const { d } = ctx;
  switch (spec.kind) {
    case "countries": {
      const rows = await api.getCountries();
      await insertMany(
        d,
        `insert into countries (id, name, avatar, currency_id, currency_name, import_tax, vat, work_tax, min_wage, is_available, updated_at)`,
        `on conflict (id) do update set name = excluded.name, avatar = excluded.avatar, currency_id = excluded.currency_id,
           currency_name = excluded.currency_name, import_tax = excluded.import_tax, vat = excluded.vat, work_tax = excluded.work_tax,
           min_wage = excluded.min_wage, is_available = excluded.is_available, updated_at = now()`,
        rows.map((c) => [
          c.id, c.name, c.avatar, c.currency?.id ?? null, c.currency?.name ?? null,
          c.laws?.import_taxes ?? null, c.laws?.vat ?? null, c.laws?.work_tax ?? null, c.laws?.minimum_wage ?? null,
          c.is_available ?? null, ctx.now,
        ]),
      );
      return { calls: 1, empty: rows.length === 0 };
    }
    case "items": {
      const { items, pages } = await api.getItems();
      await insertMany(
        d,
        `insert into items (id, name, type, quality, avatar, tradable, updated_at)`,
        `on conflict (id) do update set name = excluded.name, type = excluded.type, quality = excluded.quality,
           avatar = excluded.avatar, tradable = excluded.tradable, updated_at = now()`,
        items.map((i) => [i.id, i.name, i.type, i.quality, i.avatar, isMarketItem(i), ctx.now]),
      );
      return { calls: pages, empty: items.length === 0 };
    }
    case "stats": {
      const rows = await api.getCountryStat("activecitizens");
      if (rows.length > 0) {
        // One statement for all countries (each DB query is a subrequest on Workers).
        const values = rows.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(",");
        await d.query(
          `update countries c set active_citizens = v.n from (values ${values}) as v(id, n) where c.id = v.id`,
          rows.flatMap((r) => [r.countryId, Math.round(r.value)]),
        );
      }
      return { calls: 1, empty: rows.length === 0 };
    }
    case "regions": {
      const rows = await api.getRegions(spec.countryId!);
      for (const r of rows) ctx.regionRows.push([r.id, r.name, r.country_id ?? spec.countryId!, ctx.now]);
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
        ctx.fxSamples.push([ctx.now, cur, buyRate, sellRate]);
        ctx.fxLatest.push([cur, ctx.now, buyRate, sellRate, sum(buy.map((o) => o.amount)), sum(sell.map((o) => o.amount))]);
      }
      return { calls: 2, empty };
    }
    case "market": {
      const countryId = spec.countryId!;
      const itemId = spec.itemId!;
      const offers = await api.getItemOffers(countryId, itemId, 1);
      if (offers.length === 0) {
        ctx.marketLatest.push([countryId, itemId, ctx.now, null, null, 0, 0, "[]"]);
        return { calls: 1, empty: true };
      }
      const best = offers.reduce((a, b) => (b.value < a.value ? b : a));
      const currencyId = best.currency?.id ?? ctx.countries.get(countryId)?.currencyId ?? null;
      const rate = currencyId === GOLD_CURRENCY_ID ? 1 : currencyId != null ? ctx.fx.get(currencyId) : undefined;
      const gold = toGold(best.value, rate);
      const depth = Math.round(sum(offers.map((o) => o.amount)));
      const book = offers.slice(0, 25).map((o) => ({
        p: o.value,
        a: o.amount,
        s: o.owner?.name ?? null,
        sc: o.owner?.country_id ?? null,
        tx: o.import_tax?.rate ?? null,
      }));
      ctx.marketSamples.push([ctx.now, countryId, itemId, best.value, gold, depth, offers.length]);
      ctx.marketLatest.push([countryId, itemId, ctx.now, best.value, gold, depth, offers.length, JSON.stringify(book)]);
      return { calls: 1, empty: false };
    }
  }
}

// ---------------------------------------------------------------- persistence

async function flushRows(ctx: Ctx) {
  const { d } = ctx;
  await insertMany(d, `insert into fx_samples (ts, currency_id, buy_rate, sell_rate)`, `on conflict do nothing`, ctx.fxSamples.splice(0));
  await insertMany(
    d,
    `insert into fx_latest (currency_id, ts, buy_rate, sell_rate, buy_depth, sell_depth)`,
    `on conflict (currency_id) do update set ts = excluded.ts, buy_rate = excluded.buy_rate, sell_rate = excluded.sell_rate,
       buy_depth = excluded.buy_depth, sell_depth = excluded.sell_depth`,
    ctx.fxLatest.splice(0),
  );
  await insertMany(
    d,
    `insert into market_samples (ts, country_id, item_id, best_local, best_gold, depth, offers)`,
    `on conflict do nothing`,
    ctx.marketSamples.splice(0),
  );
  await insertMany(
    d,
    `insert into market_latest (country_id, item_id, ts, best_local, best_gold, depth, offers, book)`,
    `on conflict (country_id, item_id) do update set ts = excluded.ts, best_local = excluded.best_local, best_gold = excluded.best_gold,
       depth = excluded.depth, offers = excluded.offers, book = excluded.book`,
    ctx.marketLatest.splice(0),
    [null, null, null, null, null, null, null, "jsonb"],
  );
  await insertMany(
    d,
    `insert into regions (id, name, country_id, updated_at)`,
    `on conflict (id) do update set name = excluded.name, country_id = excluded.country_id, updated_at = now()`,
    ctx.regionRows.splice(0),
  );
}

async function loadStates(d: Db): Promise<Map<string, TaskState>> {
  const rows = await d.query<{ key: string; t: number; empty_streak: number; fail_streak: number }>(
    `select key, extract(epoch from last_run)::float8 as t, empty_streak, fail_streak from task_state`,
  );
  return new Map(rows.map((r) => [r.key, { lastRun: Number(r.t), emptyStreak: r.empty_streak, failStreak: r.fail_streak }]));
}

async function saveStates(d: Db, updates: Map<string, TaskState>) {
  const rows = [...updates].map(([key, s]) => [key, new Date(s.lastRun * 1000), s.emptyStreak, s.failStreak]);
  await insertMany(
    d,
    `insert into task_state (key, last_run, empty_streak, fail_streak)`,
    `on conflict (key) do update set last_run = excluded.last_run, empty_streak = excluded.empty_streak, fail_streak = excluded.fail_streak`,
    rows,
  );
}

async function loadFx(d: Db): Promise<Map<number, number>> {
  const rows = await d.query<{ currency_id: number; buy_rate: number | null; sell_rate: number | null }>(
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
  const countries = await d.query<{ id: number; currency_id: number | null }>(
    `select id, currency_id from countries where coalesce(is_available, true)
     order by active_citizens desc nulls last, id`,
  );
  const items = await d.query<{ id: number }>(`select id from items where tradable order by id`);
  return {
    countries: countries.map((c, rank) => ({ id: c.id, currencyId: c.currency_id, rank })),
    itemIds: items.map((i) => i.id),
  };
}

/**
 * Re-converts every latest book to Gold with the freshest currency rates, so a
 * market read hours ago doesn't keep a stale (or untrustworthy) conversion.
 * Currencies without a trustworthy rate get best_gold = null.
 */
async function regold(d: Db, fx: Map<number, number>, countries: Ctx["countries"]) {
  const currencies = [...new Set([...countries.values()].map((c) => c.currencyId).filter((c): c is number => c != null))];
  if (currencies.length === 0) return;
  const rows = currencies.map((cur) => [cur, cur === GOLD_CURRENCY_ID ? 1 : (fx.get(cur) ?? null)]);
  const values = rows.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::float8)`).join(",");
  await d.query(
    `update market_latest ml
       set best_gold = case when v.rate is null then null else ml.best_local / v.rate end
     from countries c join (values ${values}) as v(cur, rate) on v.cur = c.currency_id
     where c.id = ml.country_id and ml.best_local is not null`,
    rows.flat(),
  );
}

/** Per-item global index: cheapest recent market in Gold, plus the median across markets (one statement). */
async function computeIndex(d: Db, at: Date) {
  await d.query(
    `insert into index_samples (ts, item_id, best_gold, median_gold, markets, best_country_id)
     select $1::timestamptz, item_id, min(best_gold),
            percentile_cont(0.5) within group (order by best_gold),
            count(*)::int,
            (array_agg(country_id order by best_gold, country_id))[1]
     from market_latest
     where best_gold is not null and ts > now() - interval '${INDEX_WINDOW_HOURS} hours'
     group by item_id
     on conflict do nothing`,
    [at],
  );
}

async function prune(d: Db) {
  for (const table of ["market_samples", "fx_samples", "index_samples"]) {
    await d.query(`delete from ${table} where ts < now() - interval '${RETENTION_DAYS} days'`);
  }
  await d.query(`delete from ingest_runs where started_at < now() - interval '14 days'`);
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
