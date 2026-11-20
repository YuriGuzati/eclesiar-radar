import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { cached } from "@/lib/cache";
import { usageToday } from "@/lib/usage";
import * as api from "@/lib/eclesiar/endpoints";
import { bestOpportunity, type Quote } from "@/lib/domain/arbitrage";
import { toGold } from "@/lib/domain/fx";
import { fillCandles, pctChange, toCandles } from "@/lib/domain/ohlc";
import type { Coverage, QuotesSnapshot, SnapshotKey } from "@/lib/ingest/snapshots";
import type { WarRound } from "@/lib/eclesiar/schemas";
import type {
  ArbRow,
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
const GOLD_CURRENCY_ID = 1;
/** How long a DB read is reused inside one server instance (D1 bills rows read). */
const DB_TTL_MS = 30_000;

// ---------------------------------------------------------------- snapshots (built by the collector)

function snapshot<T>(key: SnapshotKey): Promise<T | null> {
  return cached(`snap:${key}`, DB_TTL_MS, async () => {
    const row = await (await db()).first<{ json: string }>(`select json from snapshots where key = ?`, [key]);
    return row ? (JSON.parse(row.json) as T) : null;
  });
}

const EMPTY_OVERVIEW: Overview = { updatedAt: null, countries: [], items: [] };

export async function overview(): Promise<Overview> {
  return (await snapshot<Overview>("overview")) ?? EMPTY_OVERVIEW;
}

export async function fx(): Promise<FxRow[]> {
  return (await snapshot<FxRow[]>("fx")) ?? [];
}

export async function arbitrage(homeCountryId: number | null, minUnits: number, minActive = 0): Promise<ArbRow[]> {
  const [quotes, ov] = await Promise.all([snapshot<QuotesSnapshot>("quotes"), overview()]);
  if (!quotes) return [];
  const tax = new Map(ov.countries.map((c) => [c.id, c.importTax ?? 0]));
  const active = new Map(ov.countries.map((c) => [c.id, c.active ?? 0]));
  const canSellIn = (id: number) => (active.get(id) ?? 0) >= minActive;
  const age = new Map<string, number>();
  const byItem = new Map<number, Quote[]>();
  const now = nowSec();
  for (const [itemId, countryId, bestGold, bestAmount, depth, ts] of quotes.rows) {
    age.set(`${itemId}:${countryId}`, now - ts);
    const q: Quote = { countryId, bestGold, bestAmount, depth, importTax: tax.get(countryId) ?? 0 };
    const l = byItem.get(itemId);
    if (l) l.push(q);
    else byItem.set(itemId, [q]);
  }
  const out: ArbRow[] = [];
  for (const it of ov.items) {
    const item: ItemInfo = { id: it.id, name: it.name, type: it.type, quality: it.quality, avatar: it.avatar };
    const o = bestOpportunity(item.id, byItem.get(item.id) ?? [], { homeCountryId, minUnits, canSellIn });
    if (!o) continue;
    out.push({
      item,
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
      buyAge: age.get(`${item.id}:${o.buy.countryId}`) ?? 0,
      sellAge: age.get(`${item.id}:${o.sell.countryId}`) ?? 0,
    });
  }
  return out.sort((a, b) => b.netPct - a.netPct);
}

// ---------------------------------------------------------------- per item (small, indexed reads)

/** Local-per-Gold reference rate per currency, from the currency snapshot. */
async function rates(): Promise<Map<number, number>> {
  const m = new Map<number, number>([[GOLD_CURRENCY_ID, 1]]);
  for (const r of await fx()) if (r.mid) m.set(r.currencyId, r.mid);
  return m;
}

export function itemMarkets(itemId: number, bookCountryId: number | null): Promise<ItemMarkets> {
  return cached(`market:${itemId}:${bookCountryId ?? ""}`, DB_TTL_MS, async () => {
    const d = await db();
    const now = Math.floor(nowSec());
    const [rows, rate] = await Promise.all([
      // Baseline for the 24h change: the last sample at or before 24h ago (prices
      // are sampled on change, so that sample is the price at that time).
      d.all<{ country_id: number; currency_id: number | null; best_local: number | null; depth: number; offers: number; ts: number; base_local: number | null }>(
        `select m.country_id, m.currency_id, m.best_local, m.depth, m.offers, m.ts,
                (select s.best_local from market_samples s
                  where s.item_id = m.item_id and s.country_id = m.country_id and s.ts <= ?1 and s.ts > ?2
                  order by s.ts desc limit 1) as base_local
         from market_latest m where m.item_id = ?3`,
        [now - DAY, now - DAY * 1.5, itemId],
      ),
      rates(),
    ]);
    const out = rows
      .map((r) => ({
        countryId: r.country_id,
        bestLocal: r.best_local,
        bestGold: r.best_local != null && r.currency_id != null ? toGold(r.best_local, rate.get(r.currency_id)) : null,
        depth: r.depth,
        offers: r.offers,
        updatedAt: r.ts,
        change24h: pctChange(r.base_local, r.best_local),
      }))
      .sort((a, b) => (a.bestGold ?? Infinity) - (b.bestGold ?? Infinity) || a.countryId - b.countryId);

    const bookCountry = bookCountryId ?? out.find((r) => r.bestGold != null)?.countryId ?? null;
    let book: ItemMarkets["book"] = null;
    if (bookCountry != null) {
      const b = await d.first<{ book: string; ts: number }>(`select book, ts from market_latest where item_id = ? and country_id = ?`, [itemId, bookCountry]);
      if (b) {
        let offers: unknown = [];
        try {
          offers = JSON.parse(b.book);
        } catch {
          // keep the book empty
        }
        book = { countryId: bookCountry, updatedAt: b.ts, offers: Array.isArray(offers) ? offers : [] };
      }
    }
    return { itemId, rows: out, book };
  });
}

const TF: Record<Timeframe, { bucket: number; window: number }> = {
  "15m": { bucket: 900, window: DAY },
  "1h": { bucket: 3600, window: 3 * DAY },
  "4h": { bucket: 4 * 3600, window: 14 * DAY },
  "1d": { bucket: DAY, window: 60 * DAY },
};

export function history(itemId: number, countryId: number | null, tf: Timeframe, unit: "gold" | "local"): Promise<History> {
  const col = unit === "local" ? "best_local" : "best_gold";
  return cached(`history:${itemId}:${countryId ?? ""}:${tf}:${unit}`, DB_TTL_MS, async () => {
    const d = await db();
    const { bucket, window } = TF[tf];
    const now = nowSec();
    const since = Math.floor(now - window);
    const rows =
      countryId == null
        ? await d.all<{ t: number; v: number }>(
            `select ts as t, best_gold as v from index_samples where item_id = ? and ts > ? order by ts`,
            [itemId, since],
          )
        : await d.all<{ t: number; v: number }>(
            `select ts as t, ${col} as v from market_samples
             where item_id = ? and country_id = ? and ts > ? and ${col} is not null order by ts`,
            [itemId, countryId, since],
          );
    return {
      itemId,
      countryId,
      unit: countryId == null ? "gold" : unit,
      tf,
      candles: fillCandles(toCandles(rows, bucket), bucket, now),
    };
  });
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
    const regionIds = [...new Set(data.nukes.map((n) => n.to_region_id).filter((x): x is number => x != null).map(Math.trunc))];
    const regions = regionIds.length
      ? await (await db()).all<{ id: number; name: string; country: string | null }>(
          `select r.id, r.name, c.name as country from regions r left join countries c on c.id = r.country_id
           where r.id in (select value from json_each(?))`,
          [JSON.stringify(regionIds)],
        )
      : [];
    const regionById = new Map(regions.map((r) => [r.id, r]));
    const cs = new Map((await overview()).countries.map((c) => [c.id, c.name]));
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

// ---------------------------------------------------------------- status

export async function status(): Promise<Status> {
  const server = await cached("server-status", 60_000, () => api.getServerStatus()).catch(() => null);
  const [run, coverage, used] = await Promise.all([
    cached("last-run", 15_000, async () =>
      (await db()).first<{ s: number; f: number | null; requests: number; tasks: number; errors: number; note: string | null }>(
        `select started_at as s, finished_at as f, requests, tasks, errors, note from ingest_runs order by id desc limit 1`,
      ),
    ),
    snapshot<Coverage>("coverage"),
    env.demo ? Promise.resolve(0) : cached("usage-today", 15_000, () => usageToday()),
  ]);
  return {
    mode: env.mode,
    db: "d1",
    server: server ? { day: server.server_day, time: server.server_time, version: server.version } : null,
    usageToday: used,
    dailyLimit: env.dailyLimit,
    lastRun: run ? { startedAt: run.s, finishedAt: run.f, requests: run.requests, tasks: run.tasks, errors: run.errors, note: run.note } : null,
    coverage: coverage ?? { markets: 0, withOffers: 0, fresh: 0 },
    autoIngestMinutes: env.autoIngestMinutes,
  };
}
