/**
 * Currency conversion. Throughout the app (DB included) a currency "rate"
 * means units of the local currency per 1 Gold. Every item price is
 * normalised to Gold so markets can be compared.
 *
 * The two sides of /market/coin/get are quoted differently (verified on the
 * live API, e.g. BRL: BUY ≈ 10.99, SELL ≈ 0.100):
 *  - BUY  offers sell Gold, `rate` = local currency per 1 Gold;
 *  - SELL offers sell the currency, `rate` = Gold per 1 unit of currency.
 * Both lists come cheapest first.
 */

/** Top of both coin books → local-per-Gold on each side. */
export function normalizeCoinTop(
  buyTopRate: number | null | undefined,
  sellTopRate: number | null | undefined,
): { buy: number | null; sell: number | null } {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  return { buy: ok(buyTopRate) ? buyTopRate : null, sell: ok(sellTopRate) ? 1 / sellTopRate : null };
}

/**
 * Max ratio between the two sides for a rate to count as a real price. Liquid
 * currencies sit around 1.0–1.2 (BRL 10.99 vs 10.00); dead ones are wildly
 * apart (NIS 100 vs 0.22 on the live API), and converting with them would make
 * that country look like the cheapest market for everything.
 */
export const MAX_FX_SPREAD = 2;

export function fxSpread(buy: number | null | undefined, sell: number | null | undefined): number | null {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  return ok(buy) && ok(sell) ? Math.max(buy, sell) / Math.min(buy, sell) : null;
}

/**
 * Reference rate (local per Gold): the mid of both sides, or null when the
 * currency has no trustworthy price (a side is missing or the sides disagree
 * by more than MAX_FX_SPREAD). Prices in such currencies aren't converted.
 */
export function midRate(buy: number | null | undefined, sell: number | null | undefined): number | null {
  const spread = fxSpread(buy, sell);
  if (spread == null || spread > MAX_FX_SPREAD) return null;
  return (buy! + sell!) / 2;
}

export function toGold(localPrice: number, rate: number | null | undefined): number | null {
  if (!rate || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(localPrice)) return null;
  return localPrice / rate;
}

export function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
