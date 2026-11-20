"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { sma } from "@/lib/domain/ohlc";
import type { CandleDto } from "@/lib/types";

const COLORS = { up: "#3fb950", down: "#f85149", gold: "#eab011", text: "#8b94a1", grid: "#181d24", border: "#222832" };

/** Candles + SMA(12). Times are shifted to the viewer's local time zone. */
export function CandleChart({ candles, precision }: { candles: CandleDto[]; precision: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaSeries = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COLORS.text, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    candleSeries.current = c.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
    });
    smaSeries.current = c.addSeries(LineSeries, {
      color: COLORS.gold,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const cs = candleSeries.current;
    const ss = smaSeries.current;
    if (!cs || !ss) return;
    const shift = -new Date().getTimezoneOffset() * 60;
    const fmt = { type: "price" as const, precision, minMove: 10 ** -precision };
    cs.applyOptions({ priceFormat: fmt });
    ss.applyOptions({ priceFormat: fmt });
    cs.setData(candles.map((k) => ({ time: (k.time + shift) as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    ss.setData(sma(candles, 12).map((p) => ({ time: (p.time + shift) as UTCTimestamp, value: p.value })));
    chart.current?.timeScale().fitContent();
  }, [candles, precision]);

  return <div ref={el} className="h-full w-full" />;
}
