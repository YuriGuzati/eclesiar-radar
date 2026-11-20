import { insertStatements, type Db } from "@/lib/db";
import { median } from "@/lib/domain/fx";
import { DEMO_COUNTRIES, DEMO_ITEMS, demoFxRate, demoGoldPrice, demoIsEmpty, hash } from "@/lib/eclesiar/mock";

const DAY = 86_400;

/**
 * Demo only: fills an empty database with synthetic history the first time it
 * runs, so charts and 24h changes have something to show immediately. Uses the
 * same price model as the demo transport. Kept coarse (a few thousand rows) so
 * a demo deployment stays well inside D1's free daily write quota.
 */
export async function backfillDemo(d: Db): Promise<void> {
  if (await d.first(`select 1 as x from index_samples limit 1`)) return;

  const now = Math.floor(Date.now() / 1000);

  // Currency samples every 3 hours for 7 days.
  const fx: unknown[][] = [];
  for (let t = now - 7 * DAY; t < now - 600; t += 3 * 3600) {
    for (const c of DEMO_COUNTRIES) {
      const r = demoFxRate(c.currencyId, t);
      fx.push([c.currencyId, t, r * 1.008, r * 0.992]);
    }
  }

  // Per-market samples every 3 hours for 3 days.
  const market: unknown[][] = [];
  for (let t = now - 3 * DAY; t < now - 600; t += 3 * 3600) {
    for (const c of DEMO_COUNTRIES) {
      const rate = demoFxRate(c.currencyId, t);
      for (const item of DEMO_ITEMS) {
        if (demoIsEmpty(c.id, item.id)) continue;
        const gold = demoGoldPrice(c.id, item.id, t);
        const depth = 50 + (hash("depth", c.id, item.id, t) % 2000);
        market.push([item.id, c.id, t, gold * rate, gold, depth, 12]);
      }
    }
  }

  // Global index every hour for 7 days.
  const index: unknown[][] = [];
  for (let t = now - 7 * DAY; t < now - 600; t += 3600) {
    for (const item of DEMO_ITEMS) {
      const quotes = DEMO_COUNTRIES.filter((c) => !demoIsEmpty(c.id, item.id)).map((c) => ({
        countryId: c.id,
        gold: demoGoldPrice(c.id, item.id, t),
      }));
      if (quotes.length === 0) continue;
      const best = quotes.reduce((a, b) => (b.gold < a.gold ? b : a));
      index.push([item.id, t, best.gold, median(quotes.map((q) => q.gold)), quotes.length, best.countryId]);
    }
  }

  await d.batch([
    ...insertStatements(`insert into fx_samples (currency_id, ts, buy_rate, sell_rate)`, `on conflict do nothing`, fx),
    ...insertStatements(
      `insert into market_samples (item_id, country_id, ts, best_local, best_gold, depth, offers)`,
      `on conflict do nothing`,
      market,
    ),
    ...insertStatements(
      `insert into index_samples (item_id, ts, best_gold, median_gold, markets, best_country_id)`,
      `on conflict do nothing`,
      index,
    ),
  ]);
}
