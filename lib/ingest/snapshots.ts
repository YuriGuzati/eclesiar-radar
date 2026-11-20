import { insertStatements, type Db, type Stmt } from "@/lib/db";
import { fxSpread, median, midRate, toGold } from "@/lib/domain/fx";
import { closes, pctChange, valueAt, type Point } from "@/lib/domain/ohlc";
import type { CountryInfo, FxRow, ItemInfo, Overview, OverviewItem, Status } from "@/lib/types";

/**
 * Snapshots: the collector precomputes what the pages show and stores each
 * view as one JSON row, so a page view reads a single row instead of scanning
 * every market (D1 bills rows read). Rebuilt about every 10 minutes.
 */
export const SNAPSHOT_EVERY_SEC = 600;
/** Markets older than this don't count towards the global index or arbitrage. */
const QUOTE_MAX_AGE_SEC = 12 * 3600;
/** Rolling series kept for 24h changes and sparklines. */
const SERIES_KEEP_SEC = 26 * 3600;
const DAY = 86_400;
const GOLD_CURRENCY_ID = 1;

export type Coverage = Status["coverage"];

/** Fresh quotes for arbitrage: [itemId, countryId, bestGold, bestAmount, depth, ts]. */
export interface QuotesSnapshot {
  ts: number;
  rows: [number, number, number, number, number, number][];
}

/** Rolling 26h series as [ts, value] pairs, keyed by item id / currency id. */
interface SeriesSnapshot {
  idx: Record<string, [number, number][]>;
  fx: Record<string, [number, number][]>;
}

export type SnapshotKey = "overview" | "fx" | "quotes" | "coverage" | "series";

export async function buildSnapshots(d: Db, now: number): Promise<void> {
  const [countryRows, items, latest, fxRows, seriesRow] = await Promise.all([
    d.all<{
      id: number; name: string; avatar: string | null; currency_id: number | null; currency_name: string | null;
      import_tax: number | null; vat: number | null; active_citizens: number | null;
    }>(
      `select id, name, avatar, currency_id, currency_name, import_tax, vat, active_citizens from countries
       where coalesce(is_available, 1) = 1 order by active_citizens is null, active_citizens desc, name`,
    ),
    d.all<ItemInfo>(`select id, name, type, quality, avatar from items where tradable = 1 order by type, name, quality, id`),
    // Only the first offer's amount is needed from the stored book.
    d.all<{ item_id: number; country_id: number; ts: number; currency_id: number | null; best_local: number | null; depth: number; offers: number; best_amount: number | null }>(
      `select item_id, country_id, ts, currency_id, best_local, depth, offers, json_extract(book, '$[0].a') as best_amount from market_latest`,
    ),
    d.all<{ currency_id: number; ts: number; buy_rate: number | null; sell_rate: number | null }>(
      `select currency_id, ts, buy_rate, sell_rate from fx_latest`,
    ),
    d.first<{ json: string }>(`select json from snapshots where key = 'series'`),
  ]);

  const countries: CountryInfo[] = countryRows.map((r) => ({
    id: r.id, name: r.name, avatar: r.avatar, currencyId: r.currency_id, currency: r.currency_name,
    importTax: r.import_tax, vat: r.vat, active: r.active_citizens,
  }));
  const rates = new Map<number, number>([[GOLD_CURRENCY_ID, 1]]);
  for (const r of fxRows) {
    const mid = midRate(r.buy_rate, r.sell_rate);
    if (mid) rates.set(r.currency_id, mid);
  }

  // ---- global index: cheapest and median Gold price per item over fresh markets
  const fresh = latest
    .filter((r) => r.best_local != null && r.ts > now - QUOTE_MAX_AGE_SEC)
    .map((r) => ({ ...r, gold: r.currency_id != null ? toGold(r.best_local!, rates.get(r.currency_id)) : null }))
    .filter((r): r is typeof r & { gold: number } => r.gold != null);
  const quotesByItem = new Map<number, typeof fresh>();
  for (const q of fresh) {
    const l = quotesByItem.get(q.item_id);
    if (l) l.push(q);
    else quotesByItem.set(q.item_id, [q]);
  }

  const index = new Map<number, { best: (typeof fresh)[number]; median: number | null; markets: number }>();
  for (const [itemId, qs] of quotesByItem) {
    const best = qs.reduce((a, b) => (b.gold < a.gold ? b : a));
    index.set(itemId, { best, median: median(qs.map((q) => q.gold)), markets: qs.length });
  }

  // ---- rolling series (seeded from the sample tables when missing)
  const series = seriesRow ? parseSeries(seriesRow.json) : await seedSeries(d, now);
  for (const [itemId, ix] of index) push(series.idx, itemId, now, ix.best.gold);
  for (const r of fxRows) {
    const mid = midRate(r.buy_rate, r.sell_rate);
    if (mid) push(series.fx, r.currency_id, now, mid);
  }
  trim(series, now - SERIES_KEEP_SEC);
  const pts = (rec: Record<string, [number, number][]>, id: number): Point[] => (rec[id] ?? []).map(([t, v]) => ({ t, v }));
  const change = (p: Point[], cur: number | null) =>
    cur != null && p.length > 1 && p[0].t < now - DAY / 2 ? pctChange(valueAt(p, now - DAY), cur) : null;
  const spark = (p: Point[]) => closes(p.filter((x) => x.t >= now - DAY), 3600);

  // ---- overview
  const overviewItems: OverviewItem[] = items.map((it) => {
    const ix = index.get(it.id);
    const p = pts(series.idx, it.id);
    return {
      ...it,
      bestGold: ix?.best.gold ?? null,
      bestCountryId: ix?.best.country_id ?? null,
      bestLocal: ix?.best.best_local ?? null,
      medianGold: ix?.median ?? null,
      markets: ix?.markets ?? 0,
      change24h: change(p, ix?.best.gold ?? null),
      spark: spark(p),
    };
  });
  const overview: Overview = { updatedAt: index.size ? now : null, countries, items: overviewItems };

  // ---- currencies
  const fx: FxRow[] = fxRows
    .map((r) => {
      const users = countries.filter((c) => c.currencyId === r.currency_id);
      const mid = midRate(r.buy_rate, r.sell_rate);
      const p = pts(series.fx, r.currency_id);
      return {
        currencyId: r.currency_id,
        currency: users[0]?.currency ?? `#${r.currency_id}`,
        countryIds: users.map((c) => c.id),
        buy: r.buy_rate,
        sell: r.sell_rate,
        mid,
        spread: fxSpread(r.buy_rate, r.sell_rate),
        change24h: change(p, mid),
        spark: spark(p),
        updatedAt: r.ts,
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const quotes: QuotesSnapshot = {
    ts: now,
    rows: fresh.map((q) => [q.item_id, q.country_id, q.gold, Number(q.best_amount ?? 0), q.depth, q.ts]),
  };
  const coverage: Coverage = {
    markets: latest.length,
    withOffers: latest.filter((r) => r.offers > 0).length,
    fresh: latest.filter((r) => r.ts > now - 3600).length,
  };

  const snapshot = (key: SnapshotKey, value: unknown): Stmt => ({
    sql: `insert into snapshots (key, ts, json) values (?, ?, ?) on conflict (key) do update set ts = excluded.ts, json = excluded.json`,
    params: [key, now, JSON.stringify(value)],
  });
  await d.batch([
    ...insertStatements(
      `insert into index_samples (item_id, ts, best_gold, median_gold, markets, best_country_id)`,
      `on conflict do nothing`,
      [...index].map(([itemId, ix]) => [itemId, now, ix.best.gold, ix.median, ix.markets, ix.best.country_id]),
    ),
    snapshot("overview", overview),
    snapshot("fx", fx),
    snapshot("quotes", quotes),
    snapshot("coverage", coverage),
    snapshot("series", series),
    {
      sql: `insert into meta (key, value) values ('last_snapshot', ?), ('snapshot_quotes', ?) on conflict (key) do update set value = excluded.value`,
      params: [String(now), String(fresh.length)],
    },
  ]);
}

function parseSeries(json: string): SeriesSnapshot {
  try {
    const s = JSON.parse(json) as Partial<SeriesSnapshot>;
    return { idx: s.idx ?? {}, fx: s.fx ?? {} };
  } catch {
    return { idx: {}, fx: {} };
  }
}

/** One-off read of the sample tables (first build, or after the demo backfill). */
async function seedSeries(d: Db, now: number): Promise<SeriesSnapshot> {
  const since = now - SERIES_KEEP_SEC;
  const [idx, fx] = await Promise.all([
    d.all<{ item_id: number; ts: number; best_gold: number }>(`select item_id, ts, best_gold from index_samples where ts > ? order by ts`, [since]),
    d.all<{ currency_id: number; ts: number; buy_rate: number | null; sell_rate: number | null }>(
      `select currency_id, ts, buy_rate, sell_rate from fx_samples where ts > ? order by ts`,
      [since],
    ),
  ]);
  const out: SeriesSnapshot = { idx: {}, fx: {} };
  for (const r of idx) push(out.idx, r.item_id, r.ts, r.best_gold);
  for (const r of fx) {
    const mid = midRate(r.buy_rate, r.sell_rate);
    if (mid) push(out.fx, r.currency_id, r.ts, mid);
  }
  return out;
}

function push(rec: Record<string, [number, number][]>, id: number, t: number, v: number) {
  const l = (rec[id] ??= []);
  if (l.length && l[l.length - 1][0] >= t) return; // keep ascending, no duplicates
  l.push([t, Number(v.toPrecision(8))]);
}

function trim(s: SeriesSnapshot, since: number) {
  for (const rec of [s.idx, s.fx]) {
    for (const [k, l] of Object.entries(rec)) {
      const kept = l.filter(([t]) => t > since);
      if (kept.length) rec[k] = kept;
      else delete rec[k];
    }
  }
}
