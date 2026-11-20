import type { z } from "zod";
import { call } from "./client";
import {
  CoinOfferSchema,
  CountrySchema,
  CountryStatSchema,
  ItemOfferSchema,
  ItemSchema,
  NukesSchema,
  RegionSchema,
  ServerStatusSchema,
  WarRoundSchema,
  WarSchema,
  WorldEventsSchema,
} from "./schemas";

/**
 * Parses a list payload element by element: a malformed row is dropped (and
 * logged) instead of failing the whole response. If every row fails, the shape
 * has changed upstream and we throw so the problem is visible.
 */
function parseList<S extends z.ZodType>(schema: S, data: unknown, path: string): z.infer<S>[] {
  if (data === undefined || data === null) return [];
  const arr = Array.isArray(data) ? data : [data];
  const out: z.infer<S>[] = [];
  let firstError: unknown;
  for (const row of arr) {
    const r = schema.safeParse(row);
    if (r.success) out.push(r.data);
    else firstError ??= r.error;
  }
  if (arr.length > 0 && out.length === 0) {
    throw new Error(`Unexpected response shape from ${path}: ${String(firstError)}`);
  }
  if (firstError) console.warn(`[eclesiar] dropped ${arr.length - out.length} malformed rows from ${path}`);
  return out;
}

function parseOne<S extends z.ZodType>(schema: S, data: unknown, path: string): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`Unexpected response shape from ${path}: ${r.error.message}`);
  return r.data;
}

export async function getServerStatus() {
  const data = await call("/server/status");
  return parseList(ServerStatusSchema, data, "/server/status")[0] ?? null;
}

/** All items (paginated upstream; stops at the first empty or repeated page). */
export async function getItems() {
  const seen = new Set<number>();
  const items: z.infer<typeof ItemSchema>[] = [];
  let pages = 0;
  for (let page = 1; page <= 20; page++) {
    pages++;
    const rows = parseList(ItemSchema, await call("/server/items", { page }), "/server/items");
    const fresh = rows.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) break;
    fresh.forEach((r) => seen.add(r.id));
    items.push(...fresh);
  }
  return { items, pages };
}

export async function getCountries() {
  return parseList(CountrySchema, await call("/countries"), "/countries");
}

export async function getCountryStat(statistic: string) {
  const rows = parseList(CountryStatSchema, await call("/statistics/country", { statistic }), "/statistics/country");
  return rows.map((r) => ({ countryId: r.country.id, value: Number(r.value) || 0 }));
}

export async function getRegions(countryId: number) {
  return parseList(RegionSchema, await call("/country/regions", { country_id: countryId }), "/country/regions");
}

export async function getItemOffers(countryId: number, itemId: number, page = 1) {
  return parseList(
    ItemOfferSchema,
    await call("/market/items/get", { country_id: countryId, item_id: itemId, page }),
    "/market/items/get",
  );
}

export async function getCoinOffers(currencyId: number, transaction: "BUY" | "SELL", page = 1) {
  return parseList(
    CoinOfferSchema,
    await call("/market/coin/get", { currency_id: currencyId, transaction, page }),
    "/market/coin/get",
  );
}

/** Active wars, each with its current round (damage, points, heroes) inlined. */
export async function getWars(page = 1) {
  return parseList(WarSchema, await call("/wars", { page, extra_details: 1 }), "/wars");
}

export async function getWarRounds(warId: number) {
  return parseList(WarRoundSchema, await call("/war/rounds", { war_id: warId }), "/war/rounds");
}

/** Public endpoint: no API key, no quota. */
export async function getActiveNukes() {
  const data = await call("/nukes/active", {}, { auth: false });
  if (data === undefined) return { server_time: null, nukes: [] };
  return parseOne(NukesSchema, data, "/nukes/active");
}

export async function getWorldEvents(page = 1, countryId = 0) {
  const data = await call("/world/events", { page, country_id: countryId || undefined });
  if (data === undefined) return { events: [] };
  return parseOne(WorldEventsSchema, data, "/world/events");
}
