import { insertMany, type Db } from "@/lib/db";
import { median } from "@/lib/domain/fx";
import { DEMO_COUNTRIES, DEMO_ITEMS, demoFxRate, demoGoldPrice, demoIsEmpty, hash } from "@/lib/eclesiar/mock";

/**
 * Demo only: fills the (separate) demo database with a week of synthetic
 * history the first time it runs, so charts and 24h changes have something to
 * show immediately. Uses the same price model as the demo transport.
 */
export async function backfillDemo(d: Db): Promise<void> {
  const has = await d.query<{ n: number }>(`select count(*)::int as n from index_samples`);
  if (has[0].n > 0) return;

  const now = Math.floor(Date.now() / 1000);
  const DAY = 86_400;
  const at = (t: number) => new Date(t * 1000);

  // Hourly currency samples for 7 days.
  const fx: unknown[][] = [];
  for (let t = now - 7 * DAY; t < now - 600; t += 3600) {
    for (const c of DEMO_COUNTRIES) {
      const r = demoFxRate(c.currencyId, t);
      fx.push([at(t), c.currencyId, r * 1.008, r * 0.992]);
    }
  }
  await insertMany(d, `insert into fx_samples (ts, currency_id, buy_rate, sell_rate)`, `on conflict do nothing`, fx);

  // Hourly per-market samples for 3 days.
  const market: unknown[][] = [];
  for (let t = now - 3 * DAY; t < now - 600; t += 3600) {
    for (const c of DEMO_COUNTRIES) {
      const rate = demoFxRate(c.currencyId, t);
      for (const item of DEMO_ITEMS) {
        if (demoIsEmpty(c.id, item.id)) continue;
        const gold = demoGoldPrice(c.id, item.id, t);
        const depth = 50 + (hash("depth", c.id, item.id, t) % 2000);
        market.push([at(t), c.id, item.id, gold * rate, gold, depth, 12]);
      }
    }
  }
  await insertMany(
    d,
    `insert into market_samples (ts, country_id, item_id, best_local, best_gold, depth, offers)`,
    `on conflict do nothing`,
    market,
  );

  // Global index every 20 minutes for 7 days.
  const index: unknown[][] = [];
  for (let t = now - 7 * DAY; t < now - 600; t += 1200) {
    for (const item of DEMO_ITEMS) {
      const quotes = DEMO_COUNTRIES.filter((c) => !demoIsEmpty(c.id, item.id)).map((c) => ({
        countryId: c.id,
        gold: demoGoldPrice(c.id, item.id, t),
      }));
      if (quotes.length === 0) continue;
      const best = quotes.reduce((a, b) => (b.gold < a.gold ? b : a));
      index.push([at(t), item.id, best.gold, median(quotes.map((q) => q.gold)), quotes.length, best.countryId]);
    }
  }
  await insertMany(
    d,
    `insert into index_samples (ts, item_id, best_gold, median_gold, markets, best_country_id)`,
    `on conflict do nothing`,
    index,
  );
}
