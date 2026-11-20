import { describe, expect, it } from "vitest";
import { bestOpportunity, type Quote } from "./arbitrage";
import { median, midRate, normalizeCoinTop, toGold } from "./fx";
import { closes, fillCandles, pctChange, sma, toCandles, valueAt } from "./ohlc";

describe("fx", () => {
  it("averages both sides and rejects junk or one-sided books", () => {
    expect(midRate(100, 98)).toBe(99);
    expect(midRate(null, 98)).toBeNull();
    expect(midRate(0, -1)).toBeNull();
    expect(midRate(undefined, Number.NaN)).toBeNull();
  });
  it("refuses a rate when the sides disagree too much (dead currency)", () => {
    // Live samples: NIS buy 100 vs sell 0.223; ARS 10.97 vs 16.67 is wide but usable.
    expect(midRate(100, 0.223)).toBeNull();
    expect(midRate(10.968, 16.667)).toBeCloseTo(13.82, 2);
  });
  it("normalizes the coin book: BUY is local/Gold, SELL is Gold/local (live BRL sample)", () => {
    const { buy, sell } = normalizeCoinTop(10.988, 0.1);
    expect(buy).toBe(10.988);
    expect(sell).toBeCloseTo(10);
    expect(midRate(buy, sell)).toBeCloseTo(10.494);
    expect(normalizeCoinTop(null, 0)).toEqual({ buy: null, sell: null });
  });
  it("converts local prices to Gold (rate = local per 1 Gold)", () => {
    expect(toGold(50, 100)).toBe(0.5);
    expect(toGold(50, null)).toBeNull();
    expect(toGold(50, 0)).toBeNull();
  });
  it("median handles odd/even/empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("ohlc", () => {
  const pts = [
    { t: 3600 * 2 + 10, v: 5 },
    { t: 3600 + 10, v: 1 },
    { t: 3600 + 20, v: 3 },
    { t: 3600 + 30, v: 2 },
  ];
  it("buckets unsorted samples into candles", () => {
    expect(toCandles(pts, 3600)).toEqual([
      { time: 3600, open: 1, high: 3, low: 1, close: 2 },
      { time: 7200, open: 5, high: 5, low: 5, close: 5 },
    ]);
  });
  it("fills gaps with flat candles up to now", () => {
    const filled = fillCandles(toCandles([{ t: 0, v: 4 }, { t: 3 * 3600, v: 6 }], 3600), 3600, 4 * 3600 + 5);
    expect(filled.map((c) => [c.time, c.open, c.close])).toEqual([
      [0, 4, 4],
      [3600, 4, 4],
      [7200, 4, 4],
      [10800, 6, 6],
      [14400, 6, 6],
    ]);
    expect(fillCandles([], 3600, 99999)).toEqual([]);
  });
  it("closes per bucket", () => {
    expect(closes(pts, 3600)).toEqual([2, 5]);
  });
  it("pctChange guards zero / missing baselines", () => {
    expect(pctChange(100, 110)).toBeCloseTo(10);
    expect(pctChange(0, 1)).toBeNull();
    expect(pctChange(null, 1)).toBeNull();
  });
  it("valueAt picks the last point at or before t", () => {
    const s = [...pts].sort((a, b) => a.t - b.t);
    expect(valueAt(s, 3600 + 25)).toBe(3);
    expect(valueAt(s, 0)).toBe(1); // before the series: first point
    expect(valueAt([], 5)).toBeNull();
  });
  it("sma skips the warm-up window", () => {
    const c = [1, 2, 3, 4].map((v, i) => ({ time: i, open: v, high: v, low: v, close: v }));
    expect(sma(c, 2)).toEqual([
      { time: 1, value: 1.5 },
      { time: 2, value: 2.5 },
      { time: 3, value: 3.5 },
    ]);
  });
});

describe("arbitrage", () => {
  const q = (countryId: number, bestGold: number, importTax = 10, bestAmount = 50): Quote => ({ countryId, bestGold, importTax, bestAmount, depth: bestAmount });

  it("buys in the cheapest market and sells where net is best", () => {
    const o = bestOpportunity(1, [q(1, 1.0), q(2, 1.5, 50), q(3, 1.4, 0)], { undercut: 0 })!;
    expect(o.buy.countryId).toBe(1);
    // Country 2 has the higher ask but a 50% tax; country 3 nets more.
    expect(o.sell.countryId).toBe(3);
    expect(o.netPct).toBeCloseTo(40);
    expect(o.profitGold).toBeCloseTo(50 * 0.4);
  });

  it("waives the import tax when selling in your own country", () => {
    const quotes = [q(1, 1.0), q(2, 1.5, 50), q(3, 1.4, 0)];
    const o = bestOpportunity(1, quotes, { undercut: 0, homeCountryId: 2 })!;
    expect(o.sell.countryId).toBe(2);
    expect(o.taxPct).toBe(0);
    expect(o.netPct).toBeCloseTo(50);
  });

  it("applies the undercut and can report a loss", () => {
    const o = bestOpportunity(1, [q(1, 1.0), q(2, 1.0, 0)], { undercut: 0.01 })!;
    expect(o.listGold).toBeCloseTo(0.99);
    expect(o.netPct).toBeLessThan(0);
  });

  it("ignores parked listings far above the item's median", () => {
    // Live case: Aircraft Q1 ~0.014–0.02 G everywhere, one market asking 30 G.
    const quotes = [q(1, 0.0141, 0), q(2, 0.019, 0), q(3, 0.02, 0), q(4, 0.022, 0), q(5, 30.45, 0)];
    const o = bestOpportunity(1, quotes, { undercut: 0 })!;
    expect(o.sell.countryId).toBe(4);
    expect(o.netPct).toBeLessThan(100);
  });

  it("only sells where the destination filter allows", () => {
    const quotes = [q(1, 1.0, 0), q(2, 1.4, 0), q(3, 1.2, 0)];
    const o = bestOpportunity(1, quotes, { undercut: 0, canSellIn: (id) => id !== 2 })!;
    expect(o.sell.countryId).toBe(3);
  });

  it("respects the minimum units on the buy side and needs two markets", () => {
    expect(bestOpportunity(1, [q(1, 1.0)])).toBeNull();
    const o = bestOpportunity(1, [q(1, 0.5, 0, 2), q(2, 1.0, 0, 500), q(3, 2.0, 0, 1)], { minUnits: 10, undercut: 0 })!;
    expect(o.buy.countryId).toBe(2); // country 1 only has 2 units
    expect(o.sell.countryId).toBe(3);
  });
});
