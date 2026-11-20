/** Time-series helpers. Times are Unix seconds. */

export interface Point {
  t: number;
  v: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Buckets samples into OHLC candles. The game has no trade history endpoint,
 * so candles are rebuilt from our own periodic samples of the best ask:
 * open = first sample in the bucket, close = last, high/low = extremes.
 */
export function toCandles(points: Point[], bucketSec: number): Candle[] {
  const sorted = points.filter((p) => Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const p of sorted) {
    const time = Math.floor(p.t / bucketSec) * bucketSec;
    if (!cur || cur.time !== time) {
      cur = { time, open: p.v, high: p.v, low: p.v, close: p.v };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, p.v);
      cur.low = Math.min(cur.low, p.v);
      cur.close = p.v;
    }
  }
  return out;
}

/** Last value per bucket, for sparklines. */
export function closes(points: Point[], bucketSec: number): number[] {
  return toCandles(points, bucketSec).map((c) => c.close);
}

/** Percent change, or null when there's no usable baseline. */
export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/** Simple moving average of candle closes; first n-1 candles have no value. */
export function sma(candles: Candle[], n: number): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  let acc = 0;
  for (let i = 0; i < candles.length; i++) {
    acc += candles[i].close;
    if (i >= n) acc -= candles[i - n].close;
    if (i >= n - 1) out.push({ time: candles[i].time, value: acc / n });
  }
  return out;
}

/** Value at or just before `t` (points sorted ascending), else the first point. */
export function valueAt(points: Point[], t: number): number | null {
  if (points.length === 0) return null;
  let best: Point | null = null;
  for (const p of points) {
    if (p.t <= t) best = p;
    else break;
  }
  return (best ?? points[0]).v;
}
