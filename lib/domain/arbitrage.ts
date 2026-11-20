/**
 * Cross-market arbitrage. Eclesiar has one item market per country, each in its
 * own currency, so the same item can be much cheaper in one country than in
 * another once both prices are converted to Gold.
 *
 * Model (an estimate, stated in the UI):
 *  - buy the cheapest offer in market A at its ask;
 *  - list in market B just under B's current best ask (`undercut`);
 *  - B charges its import tax on sellers from other countries, so a seller
 *    whose home country is B pays none.
 * VAT, travel and currency-exchange spreads are not modelled.
 */
import { median } from "./fx";

export interface Quote {
  countryId: number;
  bestGold: number;
  /** Units available at the best ask (first offer). */
  bestAmount: number;
  /** Units on the first order-book page. */
  depth: number;
  /** Import tax (%) market applies to foreign sellers. */
  importTax: number;
}

export interface Opportunity {
  itemId: number;
  buy: Quote;
  sell: Quote;
  /** Price you'd list at in the sell market, in Gold. */
  listGold: number;
  /** What you'd receive per unit after the sell market's import tax. */
  netGold: number;
  taxPct: number;
  grossPct: number;
  netPct: number;
  units: number;
  profitGold: number;
}

export interface ArbOptions {
  homeCountryId?: number | null;
  undercut?: number;
  minUnits?: number;
  /**
   * Destination asks above this multiple of the item's median ask are ignored:
   * on the live game, near-empty markets carry "parked" listings hundreds of
   * times the normal price that nobody buys (e.g. 30 G vs 0.014 G).
   */
  maxSellVsMedian?: number;
  /** Restricts destinations (e.g. to markets with enough active buyers). */
  canSellIn?: (countryId: number) => boolean;
}

export function bestOpportunity(itemId: number, quotes: Quote[], opts: ArbOptions = {}): Opportunity | null {
  const undercut = opts.undercut ?? 0.01;
  const minUnits = opts.minUnits ?? 1;
  const maxSellVsMedian = opts.maxSellVsMedian ?? 2;
  const valid = quotes.filter((q) => Number.isFinite(q.bestGold) && q.bestGold > 0);
  if (valid.length < 2) return null;
  const med = median(valid.map((q) => q.bestGold))!;

  const buyable = valid.filter((q) => q.bestAmount >= minUnits);
  if (buyable.length === 0) return null;
  const buy = buyable.reduce((a, b) => (b.bestGold < a.bestGold ? b : a));

  let best: Opportunity | null = null;
  for (const sell of valid) {
    if (sell.countryId === buy.countryId) continue;
    if (sell.bestGold > med * maxSellVsMedian) continue;
    if (opts.canSellIn && !opts.canSellIn(sell.countryId)) continue;
    const taxPct = opts.homeCountryId != null && opts.homeCountryId === sell.countryId ? 0 : sell.importTax || 0;
    const listGold = sell.bestGold * (1 - undercut);
    const netGold = listGold * (1 - taxPct / 100);
    const netPct = ((netGold - buy.bestGold) / buy.bestGold) * 100;
    if (!best || netPct > best.netPct) {
      const units = buy.bestAmount;
      best = {
        itemId,
        buy,
        sell,
        listGold,
        netGold,
        taxPct,
        grossPct: ((sell.bestGold - buy.bestGold) / buy.bestGold) * 100,
        netPct,
        units,
        profitGold: units * (netGold - buy.bestGold),
      };
    }
  }
  return best;
}
