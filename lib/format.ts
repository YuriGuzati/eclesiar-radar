/** Display formatting. Every number and date on screen goes through here. */

const LOCALE = "en-US";
/** Day/month order and a 24h clock read naturally for a worldwide game audience. */
const DATE_LOCALE = "en-GB";

const nf = (min: number, max: number) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });
const cache = new Map<string, Intl.NumberFormat>();
const fmt = (min: number, max: number) => {
  const k = `${min}:${max}`;
  let f = cache.get(k);
  if (!f) cache.set(k, (f = nf(min, max)));
  return f;
};

/** Precision that keeps ~3 significant digits for small prices. */
export function decimalsFor(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 2;
  if (a < 0.001) return 6;
  if (a < 0.01) return 5;
  if (a < 0.1) return 4;
  if (a < 10) return 3;
  if (a < 1000) return 2;
  return 0;
}

export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = decimalsFor(v);
  return fmt(d, d).format(v);
}

export function int(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmt(0, 0).format(Math.round(v));
}

export function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function pct(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = fmt(1, 1).format(Math.abs(v));
  return `${signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : ""}${s}%`;
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function ago(sec: number | null | undefined, nowSec: number | null): string {
  if (sec == null || nowSec == null) return "—";
  const d = Math.max(0, nowSec - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

/** "04:05", or "1:45:46" past an hour. */
export function countdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mmss = `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/** Local date/time for a Unix timestamp, e.g. "20/11, 15:56". */
export function dateTime(sec: number | null | undefined): string {
  if (sec == null) return "—";
  return new Date(sec * 1000).toLocaleString(DATE_LOCALE, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function clock(sec: number | null | undefined): string {
  if (sec == null) return "—";
  return new Date(sec * 1000).toLocaleTimeString(DATE_LOCALE, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Item categories for grouping. The API has one type per raw material
 * (CEREAL, MATERIALS, DIAMONDS = fuel, AIRMATERIALS = titanium), so they're
 * folded into one group.
 */
const CATEGORY: Record<string, string> = {
  FOOD: "Food",
  WEAPONS: "Weapons",
  AIRWEAPONS: "Aircraft",
  TICKETS: "Tickets",
  CEREAL: "Raw materials",
  MATERIALS: "Raw materials",
  DIAMONDS: "Raw materials",
  AIRMATERIALS: "Raw materials",
};
const CATEGORY_ORDER = ["Food", "Weapons", "Aircraft", "Tickets", "Raw materials"];

export function category(type: string): string {
  const t = type.toUpperCase();
  return CATEGORY[t] ?? t.charAt(0) + t.slice(1).toLowerCase();
}

export function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

export function itemLabel(it: { name: string; quality: number }): string {
  return it.quality > 0 ? `${it.name} Q${it.quality}` : it.name;
}
