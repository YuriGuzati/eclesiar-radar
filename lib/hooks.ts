"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ArbRow,
  CountryInfo,
  EventDto,
  FxRow,
  History,
  ItemMarkets,
  NukeDto,
  Overview,
  Status,
  Timeframe,
  WarDetail,
  WarDto,
} from "@/lib/types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

// Polling pauses automatically while the tab is hidden (TanStack default).
function usePoll<T>(key: unknown[], url: string | null, everyMs: number) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => getJson<T>(url!),
    enabled: url != null,
    refetchInterval: everyMs,
    placeholderData: (prev) => prev,
  });
}

export const useStatus = () => usePoll<Status>(["status"], "/api/status", 30_000);
export const useOverview = () => usePoll<Overview>(["overview"], "/api/overview", 30_000);
export const useFx = () => usePoll<FxRow[]>(["fx"], "/api/fx", 60_000);
export const useWars = () => usePoll<WarDto[]>(["wars"], "/api/wars", 60_000);
export const useNukes = () => usePoll<{ serverTime: number | null; nukes: NukeDto[] }>(["nukes"], "/api/nukes", 15_000);
export const useEvents = () => usePoll<EventDto[]>(["events"], "/api/events", 60_000);

export const useItemMarkets = (itemId: number | null, country: number | null) =>
  usePoll<ItemMarkets>(["market", itemId, country], itemId == null ? null : `/api/market/${itemId}${country != null ? `?country=${country}` : ""}`, 30_000);

export const useHistory = (itemId: number | null, country: number | null, tf: Timeframe, unit: "gold" | "local") =>
  usePoll<History>(
    ["history", itemId, country, tf, unit],
    itemId == null ? null : `/api/history?item=${itemId}&tf=${tf}&unit=${unit}${country != null ? `&country=${country}` : ""}`,
    60_000,
  );

export const useArbitrage = (home: number | null, minUnits: number, minActive: number) =>
  usePoll<ArbRow[]>(
    ["arb", home, minUnits, minActive],
    `/api/arbitrage?minUnits=${minUnits}&minActive=${minActive}${home != null ? `&home=${home}` : ""}`,
    60_000,
  );

export const useWarDetail = (warId: number | null) =>
  usePoll<WarDetail>(["war", warId], warId == null ? null : `/api/wars/${warId}`, 60_000);

/** Current time in seconds, ticking; null until mounted (keeps prerender deterministic). */
export function useNow(everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000);
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Country lookup from the overview payload (already polled by most pages). */
export function useCountries(): Map<number, CountryInfo> {
  const { data } = useOverview();
  return useMemo(() => new Map((data?.countries ?? []).map((c) => [c.id, c])), [data?.countries]);
}
