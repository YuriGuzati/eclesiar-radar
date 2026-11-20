import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { cached } from "@/lib/cache";
import { usageToday } from "@/lib/usage";
import * as api from "@/lib/eclesiar/endpoints";
import { bestOpportunity, type Quote } from "@/lib/domain/arbitrage";
import { fxSpread, midRate } from "@/lib/domain/fx";
import { closes, pctChange, valueAt, toCandles, type Point } from "@/lib/domain/ohlc";
import type { WarRound } from "@/lib/eclesiar/schemas";
import type {
  ArbRow,
  CountryInfo,
  EventDto,
  FxRow,
  HeroDto,
  History,
  ItemInfo,
  ItemMarkets,
  NukeDto,
  Overview,
  RoundDto,
  Status,
  Timeframe,
  WarDetail,
  WarDto,
} from "@/lib/types";

const DAY = 86_400;
const nowSec = () => Date.now() / 1000;

// ---------------------------------------------------------------- reference

export async function countries(): Promise<CountryInfo[]> {
  const d = await db();
  const rows = await d.query<{
    id: number; name: string; avatar: string | null; currency_id: number | null; currency_name: string | null;
    import_tax: number | null; vat: number | null; active_citizens: number | null;
  }>(`select id, name, avatar, currency_id, currency_name, import_tax, vat, active_citizens
      from countries where coalesce(is_available, true) order by active_citizens desc nulls last, name`);
  return rows.map((r) => ({
    id: r.id, name: r.name, avatar: r.avatar, currencyId: r.currency_id, currency: r.currency_name,
    importTax: r.import_tax, vat: r.vat, active: r.active_citizens,
  }));
}

export async function items(): Promise<ItemInfo[]> {
  const d = await db();
  return d.query<ItemInfo>(`select id, name, type, quality, avatar from items where tradable order by type, name, quality, id`);
}

// ---------------------------------------------------------------- markets

export async function overview(): Promise<Overview> {
  const d = await db();
  const [cs, its, idx, latest] = await Promise.all([
    countries(),
    items(),
    d.query<{ item_id: number; t: number; best_gold: number; median_gold: number | null; markets: number; best_country_id: number | null }>(
      `select item_id, extract(epoch from ts)::float8 as t, best_gold, median_gold, markets, best_country_id
       from index_samples where ts > now() - interval '26 hours' order by ts`,
    ),
    d.query<{ item_id: number; country_id: number; best_local: number }>(
      `select item_id, country_id, best_local from market_latest where best_local is not null`,
    ),
  ]);

  const byItem = new Map<number, typeof idx>();
  for (const r of idx) {
    const l = byItem.get(r.item_id) ?? [];
    l.push(r);
    byItem.set(r.item_id, l);
  }
  const localOf = new Map(latest.map((r) => [`${r.item_id}:${r.country_id}`, r.best_local]));
  const now = nowSec();
  let updatedAt: number | null = null;

  const out = its.map((it) => {
    const series = byItem.get(it.id) ?? [];
    const last = series.at(-1);
    if (last) updatedAt = Math.max(updatedAt ?? 0, last.t);
    const pts: Point[] = series.map((r) => ({ t: r.t, v: r.best_gold }));
    const dayAgo = valueAt(pts, now - DAY);
    return {
      ...it,
      bestGold: last?.best_gold ?? null,
      bestCountryId: last?.best_country_id ?? null,
      bestLocal: last?.best_country_id != null ? (localOf.get(`${it.id}:${last.best_country_id}`) ?? null) : null,
      medianGold: last?.median_gold ?? null,
      markets: last?.markets ?? 0,
      change24h: last && pts.length > 1 && pts[0].t < now - DAY * 0.5 ? pctChange(dayAgo, last.best_gold) : null,
      spark: closes(pts.filter((p) => p.t >= now - DAY), 3600),
    };
  });
  return { updatedAt, countries: cs, items: out };
}

export async function itemMarkets(itemId: number, bookCountryId: number | null): Promise<ItemMarkets> {
  const d = await db();
  const [rows, dayAgo] = await Promise.all([
    d.query<{ country_id: number; best_local: number | null; best_gold: number | null; depth: number; offers: number; t: number }>(
      `select country_id, best_local, best_gold, depth, offers, extract(epoch from ts)::float8 as t
       from market_latest where item_id = $1 order by best_gold asc nulls last, country_id`,
      [itemId],
    ),
    d.query<{ country_id: number; best_gold: number | null; t: number }>(
      `select distinct on (country_id) country_id, best_gold, extract(epoch from ts)::float8 as t from market_samples
       where item_id = $1 and ts > now() - interval '24 hours' order by country_id, ts asc`,
      [itemId],
    ),
  ]);
  // Only a baseline at least 12h old counts as a "24h change".
  const base = new Map(dayAgo.filter((r) => r.t < nowSec() - DAY / 2).map((r) => [r.country_id, r.best_gold]));
  const bookCountry = bookCountryId ?? rows.find((r) => r.best_gold != null)?.country_id ?? null;
  let book: ItemMarkets["book"] = null;
  if (bookCountry != null) {
    const b = await d.query<{ book: unknown; t: number }>(
      `select book, extract(epoch from ts)::float8 as t from market_latest where item_id = $1 and country_id = $2`,
      [itemId, bookCountry],
    );
    if (b[0]) {
      const offers = typeof b[0].book === "string" ? JSON.parse(b[0].book) : b[0].book;
      book = { countryId: bookCountry, updatedAt: b[0].t, offers: Array.isArray(offers) ? offers : [] };
    }
  }
  return {
    itemId,
    rows: rows.map((r) => ({
      countryId: r.country_id,
      bestLocal: r.best_local,
      bestGold: r.best_gold,
      depth: r.depth,
      offers: r.offers,
      updatedAt: r.t,
      change24h: pctChange(base.get(r.country_id), r.best_gold),
    })),
    book,
  };
}

const TF: Record<Timeframe, { bucket: number; window: string }> = {
  "15m": { bucket: 900, window: "1 day" },
  "1h": { bucket: 3600, window: "3 days" },
  "4h": { bucket: 4 * 3600, window: "14 days" },
  "1d": { bucket: DAY, window: "60 days" },
};

export async function history(itemId: number, countryId: number | null, tf: Timeframe, unit: "gold" | "local"): Promise<History> {
  const d = await db();
  const { bucket, window } = TF[tf];
  const rows =
    countryId == null
      ? await d.query<{ t: number; v: number }>(
          `select extract(epoch from ts)::float8 as t, best_gold as v from index_samples
           where item_id = $1 and ts > now() - $2::interval order by ts`,
          [itemId, window],
        )
      : await d.query<{ t: number; v: number }>(
          `select extract(epoch from ts)::float8 as t, ${unit === "local" ? "best_local" : "best_gold"} as v from market_samples
           where item_id = $1 and country_id = $2 and ts > now() - $3::interval
             and ${unit === "local" ? "best_local" : "best_gold"} is not null order by ts`,
          [itemId, countryId, window],
        );
  return { itemId, countryId, unit: countryId == null ? "gold" : unit, tf, candles: toCandles(rows, bucket) };
}

export async function fx(): Promise<FxRow[]> {
  const d = await db();
  const [latest, samples, cs] = await Promise.all([
    d.query<{ currency_id: number; buy_rate: number | null; sell_rate: number | null; t: number }>(
      `select currency_id, buy_rate, sell_rate, extract(epoch from ts)::float8 as t from fx_latest`,
    ),
    d.query<{ currency_id: number; t: number; buy_rate: number | null; sell_rate: number | null }>(
      `select currency_id, extract(epoch from ts)::float8 as t, buy_rate, sell_rate from fx_samples
       where ts > now() - interval '26 hours' order by ts`,
    ),
    countries(),
  ]);
  const series = new Map<number, Point[]>();
  for (const s of samples) {
    const m = midRate(s.buy_rate, s.sell_rate);
    if (m == null) continue;
    const l = series.get(s.currency_id) ?? [];
    l.push({ t: s.t, v: m });
    series.set(s.currency_id, l);
  }
  const now = nowSec();
  return latest
    .map((r) => {
      const users = cs.filter((c) => c.currencyId === r.currency_id);
      const mid = midRate(r.buy_rate, r.sell_rate);
      const pts = series.get(r.currency_id) ?? [];
      return {
        currencyId: r.currency_id,
        currency: users[0]?.currency ?? `#${r.currency_id}`,
        countryIds: users.map((c) => c.id),
        buy: r.buy_rate,
        sell: r.sell_rate,
        mid,
        spread: fxSpread(r.buy_rate, r.sell_rate),
        change24h: pts.length > 1 && pts[0].t < now - DAY * 0.5 ? pctChange(valueAt(pts, now - DAY), mid) : null,
        spark: closes(pts.filter((p) => p.t >= now - DAY), 3600),
        updatedAt: r.t,
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function arbitrage(homeCountryId: number | null, minUnits: number, minActive = 0): Promise<ArbRow[]> {
  const d = await db();
  const [rows, its, cs] = await Promise.all([
    d.query<{ item_id: number; country_id: number; best_gold: number; depth: number; book: unknown; t: number }>(
      `select item_id, country_id, best_gold, depth, book, extract(epoch from ts)::float8 as t
       from market_latest where best_gold is not null and ts > now() - interval '12 hours'`,
    ),
    items(),
    countries(),
  ]);
  const tax = new Map(cs.map((c) => [c.id, c.importTax ?? 0]));
  const active = new Map(cs.map((c) => [c.id, c.active ?? 0]));
  const canSellIn = (id: number) => (active.get(id) ?? 0) >= minActive;
  const age = new Map<string, number>();
  const byItem = new Map<number, Quote[]>();
  const now = nowSec();
  for (const r of rows) {
    const book = (typeof r.book === "string" ? JSON.parse(r.book) : r.book) as { a?: number }[] | null;
    const q: Quote = {
      countryId: r.country_id,
      bestGold: r.best_gold,
      bestAmount: Number(book?.[0]?.a ?? 0),
      depth: r.depth,
      importTax: tax.get(r.country_id) ?? 0,
    };
    age.set(`${r.item_id}:${r.country_id}`, now - r.t);
    const l = byItem.get(r.item_id) ?? [];
    l.push(q);
    byItem.set(r.item_id, l);
  }
  const out: ArbRow[] = [];
  for (const it of its) {
    const o = bestOpportunity(it.id, byItem.get(it.id) ?? [], { homeCountryId, minUnits, canSellIn });
    if (!o) continue;
    out.push({
      item: it,
      buyCountryId: o.buy.countryId,
      buyGold: o.buy.bestGold,
      buyUnits: o.units,
      sellCountryId: o.sell.countryId,
      sellGold: o.sell.bestGold,
      listGold: o.listGold,
      netGold: o.netGold,
      taxPct: o.taxPct,
      grossPct: o.grossPct,
      netPct: o.netPct,
      profitGold: o.profitGold,
      buyAge: age.get(`${it.id}:${o.buy.countryId}`) ?? 0,
      sellAge: age.get(`${it.id}:${o.sell.countryId}`) ?? 0,
    });
  }
  return out.sort((a, b) => b.netPct - a.netPct);
}

// ---------------------------------------------------------------- live (cached, not stored)

export function wars(): Promise<WarDto[]> {
  return cached("wars", 60_000, async () => {
    const all = [];
    for (let page = 1; page <= 4; page++) {
      const rows = await api.getWars(page);
      all.push(...rows);
      if (rows.length < 25) break;
    }
    return all.map((w) => ({
      id: w.id,
      attackers: { id: w.attackers.id, name: w.attackers.name, avatar: w.attackers.avatar },
      defenders: { id: w.defenders.id, name: w.defenders.name, avatar: w.defenders.avatar },
      region: w.region?.name ?? null,
      attackersScore: w.attackers_score,
      defendersScore: w.defenders_score,
      round: w.current_round_number ?? null,
      roundId: w.current_round_id ?? null,
      revolution: Boolean(w.flags?.is_revolution),
      civilWar: Boolean(w.flags?.is_civil_war),
      current: w.current_round ? toRound(w.current_round) : null,
    }));
  });
}

/** Game timestamps are UTC "YYYY-MM-DD HH:MM:SS". */
export function utcToUnix(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(`${s.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

const toHero = (h: WarRound["attackers_hero"]): HeroDto | null =>
  h ? { id: h.id, name: h.username, avatar: h.avatar, damage: h.damage } : null;

function toRound(r: WarRound): RoundDto {
  return {
    id: r.id,
    endsAt: utcToUnix(r.end_date),
    attackersDamage: r.attackers_score,
    defendersDamage: r.defenders_score,
    attackersPoints: r.attackers_points,
    defendersPoints: r.defenders_points,
    attackersHero: toHero(r.attackers_hero),
    defendersHero: toHero(r.defenders_hero),
  };
}

/** Every round of a war (the API also lists the scheduled ones), with status and winner. */
export function warDetail(warId: number): Promise<WarDetail> {
  return cached(`war:${warId}`, 60_000, async () => {
    const rounds = await api.getWarRounds(warId);
    const currentId = (await wars()).find((w) => w.id === warId)?.roundId ?? null;
    const now = nowSec();
    return {
      id: warId,
      rounds: rounds.map((r, k) => {
        const dto = toRound(r);
        const status: "done" | "live" | "scheduled" =
          currentId != null
            ? r.id < currentId ? "done" : r.id === currentId ? "live" : "scheduled"
            : dto.endsAt != null && dto.endsAt < now ? "done" : "live";
        const winner =
          status !== "done" || dto.attackersPoints === dto.defendersPoints
            ? null
            : dto.attackersPoints > dto.defendersPoints ? "att" : "def";
        return { ...dto, number: k + 1, status, winner };
      }),
    };
  });
}

export function nukes(): Promise<{ serverTime: number | null; nukes: NukeDto[] }> {
  return cached("nukes", 10_000, async () => {
    const data = await api.getActiveNukes();
    const d = await db();
    const regionIds = data.nukes.map((n) => n.to_region_id).filter((x): x is number => x != null);
    const regions = regionIds.length
      ? await d.query<{ id: number; name: string; country: string | null }>(
          // Array passed as a Postgres literal: portable across postgres.js and PGlite.
          `select r.id, r.name, c.name as country from regions r left join countries c on c.id = r.country_id where r.id = any($1::int[])`,
          [`{${regionIds.map((n) => Math.trunc(n)).join(",")}}`],
        )
      : [];
    const regionById = new Map(regions.map((r) => [r.id, r]));
    const cs = new Map((await countries()).map((c) => [c.id, c.name]));
    return {
      serverTime: data.server_time ?? null,
      nukes: data.nukes.map((n) => {
        const reg = n.to_region_id != null ? regionById.get(n.to_region_id) : undefined;
        return {
          id: n.nuke_id,
          fromCountryId: n.from_country_id ?? null,
          fromCountry: n.from_country_id != null ? (cs.get(n.from_country_id) ?? null) : null,
          toRegion: reg?.name ?? (n.to_region_id != null ? `Region #${n.to_region_id}` : null),
          toCountry: reg?.country ?? null,
          launchedAt: n.launched_at,
          impactAt: n.impact_at,
        };
      }),
    };
  });
}

const stripHtml = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export function events(): Promise<EventDto[]> {
  return cached("events", 60_000, async () => {
    const data = await api.getWorldEvents(1);
    return data.events.map((e) => ({
      type: e.id ?? null,
      title: stripHtml(e.title ?? ""),
      text: stripHtml(e.content ?? ""),
      createdAt: utcToUnix(e.created_at),
      nukeId: e.nuke_id ?? null,
    }));
  });
}

export async function status(): Promise<Status> {
  const d = await db();
  const server = await cached("server-status", 60_000, () => api.getServerStatus()).catch(() => null);
  const [run, cov, used] = await Promise.all([
    d.query<{ s: number; f: number | null; requests: number; tasks: number; errors: number; note: string | null }>(
      `select extract(epoch from started_at)::float8 as s, extract(epoch from finished_at)::float8 as f, requests, tasks, errors, note
       from ingest_runs where finished_at is not null order by id desc limit 1`,
    ),
    d.query<{ markets: number; with_offers: number; fresh: number }>(
      `select count(*)::int as markets, count(*) filter (where offers > 0)::int as with_offers,
              count(*) filter (where ts > now() - interval '1 hour')::int as fresh from market_latest`,
    ),
    env.demo ? Promise.resolve(0) : usageToday(),
  ]);
  const r = run[0];
  return {
    mode: env.mode,
    db: d.kind,
    server: server ? { day: server.server_day, time: server.server_time, version: server.version } : null,
    usageToday: used,
    dailyLimit: env.dailyLimit,
    lastRun: r ? { startedAt: r.s, finishedAt: r.f, requests: r.requests, tasks: r.tasks, errors: r.errors, note: r.note } : null,
    coverage: { markets: cov[0]?.markets ?? 0, withOffers: cov[0]?.with_offers ?? 0, fresh: cov[0]?.fresh ?? 0 },
    autoIngestMinutes: env.autoIngestMinutes,
  };
}
