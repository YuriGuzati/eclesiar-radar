/**
 * Demo transport: answers Eclesiar API paths with deterministic synthetic data
 * shaped like the live API, so the whole pipeline (collector → DB → UI) runs
 * without an API key. Prices are smooth functions of time, which lets the demo
 * backfill realistic history without making any request.
 *
 * Reference data (country/item ids, names, currencies, laws, flag and icon
 * URLs) mirrors what the live API returned in Nov 2026, so the demo looks like
 * the real game. Prices, offers, wars and events are synthetic.
 */
import type { Params } from "./client";

// ---------------------------------------------------------------- randomness

export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const unit = (...parts: (string | number)[]) => hash(...parts) / 4294967296;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- reference

interface DemoCountry {
  id: number;
  name: string;
  avatar: string;
  currencyId: number;
  currency: string;
  fxBase: number; // local currency per 1 Gold
  importTax: number;
  vat: number;
  workTax: number;
  minWage: number;
  active: number;
  regions: string[];
}

const MEDIA = "https://storage.eclesiar.com/medias";

// Ids, currencies, laws, active citizens and flags as returned by the live API.
export const DEMO_COUNTRIES: DemoCountry[] = [
  { id: 7, name: "Brazil", avatar: `${MEDIA}/606.svg?v=d68bae6745192c6cfc0d4cb8f4108f89`, currencyId: 7, currency: "BRL", fxBase: 10.5, importTax: 25, vat: 5, workTax: 20, minWage: 10, active: 119, regions: ["Brasília", "Porto Alegre", "Natal", "Manaus"] },
  { id: 18, name: "Poland", avatar: `${MEDIA}/628.svg?v=caba4372cd907301c9b303becc8e5bef`, currencyId: 17, currency: "PLN", fxBase: 4.0, importTax: 17, vat: 9, workTax: 10, minWage: 6, active: 108, regions: ["Warsaw", "Krakow", "Gdansk", "Krasnodar"] },
  { id: 3, name: "United States of America", avatar: `${MEDIA}/552.svg?v=4dafdd04dea199364c3e77ca67c4edc6`, currencyId: 3, currency: "USD", fxBase: 10.7, importTax: 25, vat: 25, workTax: 15, minWage: 10, active: 85, regions: ["California", "Texas", "New York", "Florida"] },
  { id: 10, name: "Argentina", avatar: `${MEDIA}/611.svg?v=7d290fffcd4bcd630c2da72ff26e1d7b`, currencyId: 9, currency: "ARS", fxBase: 13.8, importTax: 7, vat: 0, workTax: 5, minWage: 7, active: 68, regions: ["Buenos Aires", "Cordoba", "Mendoza", "Patagonia"] },
  { id: 13, name: "Portugal", avatar: `${MEDIA}/619.svg?v=eaf5750ef38a83dd03bbdcc6fa3f9a72`, currencyId: 12, currency: "PTE", fxBase: 9.9, importTax: 9, vat: 10, workTax: 13, minWage: 10, active: 62, regions: ["Lisbon", "Porto", "Algarve", "Madeira"] },
  { id: 21, name: "Croatia", avatar: `${MEDIA}/631.svg?v=489f231d9c127d8dd4c39bae34477261`, currencyId: 20, currency: "HRK", fxBase: 5.26, importTax: 25, vat: 25, workTax: 25, minWage: 5, active: 38, regions: ["Zagreb", "Osijek", "Split", "Rijeka"] },
  { id: 23, name: "Serbia", avatar: `${MEDIA}/633.svg?v=6eb948bdbacfa2e0700501c896902cbc`, currencyId: 22, currency: "RSD", fxBase: 7.3, importTax: 15, vat: 10, workTax: 15, minWage: 10, active: 33, regions: ["Belgrade", "Vojvodina", "Craiova", "Nis"] },
  { id: 15, name: "Germany", avatar: `${MEDIA}/625.svg?v=997c156927ad60e868d189dc1a568451`, currencyId: 14, currency: "DEM", fxBase: 6.2, importTax: 15, vat: 5, workTax: 11, minWage: 4, active: 29, regions: ["Berlin", "Bavaria", "Saxony", "Hamburg"] },
  { id: 17, name: "Italy", avatar: `${MEDIA}/627.svg?v=c443c6ead9568d30ec1c7168cf6a6c42`, currencyId: 16, currency: "ITL", fxBase: 4.12, importTax: 20, vat: 9, workTax: 12, minWage: 4, active: 26, regions: ["Milano", "Bari", "Rome", "Sicily"] },
  { id: 14, name: "Spain", avatar: `${MEDIA}/621.svg?v=592997927b4e7d95026c19fecf1e8421`, currencyId: 13, currency: "ESP", fxBase: 2.13, importTax: 54, vat: 65, workTax: 25, minWage: 2, active: 21, regions: ["Madrid", "Catalonia", "Andalusia", "Galicia"] },
  { id: 2, name: "United Kingdom", avatar: `${MEDIA}/551.svg?v=791d71a6f875d38a7017a96517e1e5bb`, currencyId: 2, currency: "GBP", fxBase: 10.2, importTax: 25, vat: 5, workTax: 10, minWage: 8, active: 14, regions: ["London", "Belfast", "Wales", "Midlands"] },
  { id: 4, name: "Mexico", avatar: `${MEDIA}/555.svg?v=2ad46961e88fb067c1742f54e67b2be1`, currencyId: 4, currency: "MXN", fxBase: 4.78, importTax: 12, vat: 1, workTax: 15, minWage: 5, active: 8, regions: ["Mexico City", "Guadalajara", "Tuxtla Gutiérrez", "Sonora"] },
  { id: 28, name: "Romania", avatar: `${MEDIA}/638.svg?v=a708987fd5059943aa0e3d620a62ae52`, currencyId: 27, currency: "RON", fxBase: 5.05, importTax: 8, vat: 12, workTax: 12, minWage: 5, active: 6, regions: ["Bucharest", "Transylvania", "Moldavia", "Dobruja"] },
  { id: 31, name: "Turkey", avatar: `${MEDIA}/640.svg?v=00c2d454691e9ad8b41694d9e7da847f`, currencyId: 29, currency: "TRY", fxBase: 13.2, importTax: 0, vat: 0, workTax: 0, minWage: 3, active: 4, regions: ["Istanbul", "Izmir", "Erzurum", "Gaziantep"] },
];

interface DemoItem {
  id: number;
  name: string;
  type: string;
  quality: number;
  avatar: string;
  baseGold: number;
}

// The 24 economy items with their live ids, types and icons; base prices are
// in the range the live markets showed.
export const DEMO_ITEMS: DemoItem[] = [
  { id: 1, name: "Grain", type: "CEREAL", quality: 0, avatar: `${MEDIA}/25.png?v=d31c299a2fdda78be68d2d527e4b6fdd`, baseGold: 0.0104 },
  { id: 2, name: "Food", type: "FOOD", quality: 1, avatar: `${MEDIA}/24.png?v=a73459da52f5cd3b56baef35e24d3d0b`, baseGold: 0.021 },
  { id: 3, name: "Food", type: "FOOD", quality: 2, avatar: `${MEDIA}/23.png?v=a73459da52f5cd3b56baef35e24d3d0b`, baseGold: 0.028 },
  { id: 4, name: "Food", type: "FOOD", quality: 3, avatar: `${MEDIA}/22.png?v=a73459da52f5cd3b56baef35e24d3d0b`, baseGold: 0.043 },
  { id: 5, name: "Food", type: "FOOD", quality: 4, avatar: `${MEDIA}/21.png?v=5721a327107fe5ca6ecfd03d38ca0d97`, baseGold: 0.087 },
  { id: 6, name: "Food", type: "FOOD", quality: 5, avatar: `${MEDIA}/20.png?v=5721a327107fe5ca6ecfd03d38ca0d97`, baseGold: 0.167 },
  { id: 7, name: "Iron", type: "MATERIALS", quality: 0, avatar: `${MEDIA}/19.png?v=aa10156e42103f941b5a6a022e2237a6`, baseGold: 0.0136 },
  { id: 8, name: "Weapon", type: "WEAPONS", quality: 1, avatar: `${MEDIA}/18.png?v=478fba517478e3d5e9ccf079b022a718`, baseGold: 0.0064 },
  { id: 9, name: "Weapon", type: "WEAPONS", quality: 2, avatar: `${MEDIA}/17.png?v=478fba517478e3d5e9ccf079b022a718`, baseGold: 0.0112 },
  { id: 10, name: "Weapon", type: "WEAPONS", quality: 3, avatar: `${MEDIA}/16.png?v=dcb944ef456e044fe1e972eb7d6fb9ff`, baseGold: 0.0179 },
  { id: 11, name: "Weapon", type: "WEAPONS", quality: 4, avatar: `${MEDIA}/15.png?v=dcb944ef456e044fe1e972eb7d6fb9ff`, baseGold: 0.032 },
  { id: 12, name: "Weapon", type: "WEAPONS", quality: 5, avatar: `${MEDIA}/14.png?v=64471ae2b8851a5f2e35217af96a0a40`, baseGold: 0.0421 },
  { id: 13, name: "Fuel", type: "DIAMONDS", quality: 0, avatar: `${MEDIA}/13.png?v=27a7d931e34d0717e67df2b79189bef2`, baseGold: 0.0157 },
  { id: 14, name: "Airplane ticket", type: "TICKETS", quality: 1, avatar: `${MEDIA}/12.png?v=24ce56044419a0fb40bdd15b27ae1483`, baseGold: 0.0181 },
  { id: 15, name: "Airplane ticket", type: "TICKETS", quality: 2, avatar: `${MEDIA}/11.png?v=c48f6ff3ccf7ff7e121d299a2d7e330b`, baseGold: 0.0432 },
  { id: 16, name: "Airplane ticket", type: "TICKETS", quality: 3, avatar: `${MEDIA}/10.png?v=c48f6ff3ccf7ff7e121d299a2d7e330b`, baseGold: 0.0882 },
  { id: 17, name: "Airplane ticket", type: "TICKETS", quality: 4, avatar: `${MEDIA}/9.png?v=088201f33d1ecc8ab2a22ed590c48d13`, baseGold: 0.193 },
  { id: 18, name: "Airplane ticket", type: "TICKETS", quality: 5, avatar: `${MEDIA}/8.png?v=088201f33d1ecc8ab2a22ed590c48d13`, baseGold: 0.271 },
  { id: 19, name: "Titanium", type: "AIRMATERIALS", quality: 0, avatar: `${MEDIA}/7.png?v=c2f047409d44f51e43c7d83df229ecb0`, baseGold: 0.0139 },
  { id: 20, name: "Aircraft", type: "AIRWEAPONS", quality: 1, avatar: `${MEDIA}/2.png?v=9301d6c587dd1550f1cfe2309e566c6a`, baseGold: 0.0141 },
  { id: 21, name: "Aircraft", type: "AIRWEAPONS", quality: 2, avatar: `${MEDIA}/3.png?v=e86dadf698eea9536689e4065f74a2d3`, baseGold: 0.0304 },
  { id: 22, name: "Aircraft", type: "AIRWEAPONS", quality: 3, avatar: `${MEDIA}/4.png?v=e86dadf698eea9536689e4065f74a2d3`, baseGold: 0.047 },
  { id: 23, name: "Aircraft", type: "AIRWEAPONS", quality: 4, avatar: `${MEDIA}/5.png?v=b8461a8bb443c1f6cd295611e9b264ac`, baseGold: 0.0675 },
  { id: 24, name: "Aircraft", type: "AIRWEAPONS", quality: 5, avatar: `${MEDIA}/6.png?v=b8461a8bb443c1f6cd295611e9b264ac`, baseGold: 0.094 },
];

const RAW_TYPES = new Set(["CEREAL", "MATERIALS", "DIAMONDS", "AIRMATERIALS"]);

const countryById = new Map(DEMO_COUNTRIES.map((c) => [c.id, c]));
const countryByCurrency = new Map(DEMO_COUNTRIES.map((c) => [c.currencyId, c]));
const itemById = new Map(DEMO_ITEMS.map((i) => [i.id, i]));

// ---------------------------------------------------------------- price model

/** Some markets are simply empty (no sellers), like in the real game. */
export function demoIsEmpty(countryId: number, itemId: number): boolean {
  const item = itemById.get(itemId);
  const h = hash("empty", countryId, itemId);
  if (item?.type === "AIRWEAPONS") return h % 3 === 0;
  return h % 11 === 0;
}

function wave(t: number, seed: string, amp: number, minH: number, maxH: number): number {
  const period = (minH + unit(seed, "p") * (maxH - minH)) * 3600;
  return amp * Math.sin((TAU * t) / period + unit(seed, "ph") * TAU);
}

/** Local currency per 1 Gold. */
export function demoFxRate(currencyId: number, t: number): number {
  const c = countryByCurrency.get(currencyId);
  const base = c?.fxBase ?? 100;
  return base * (1 + wave(t, `fx${currencyId}a`, 0.04, 30, 70) + wave(t, `fx${currencyId}b`, 0.012, 4, 9));
}

/** Cheapest ask for an item in a market, in Gold. */
export function demoGoldPrice(countryId: number, itemId: number, t: number): number {
  const item = itemById.get(itemId);
  const base = item?.baseGold ?? 0.05;
  const cf = 0.82 + 0.4 * unit("cf", countryId, itemId);
  const common = wave(t, `it${itemId}`, 0.06, 40, 90);
  const local = wave(t, `m${countryId}:${itemId}a`, 0.07, 6, 30) + wave(t, `m${countryId}:${itemId}b`, 0.03, 2, 5);
  const jitter = (unit("j", countryId, itemId, Math.floor(t / 600)) - 0.5) * 0.02;
  return base * cf * (1 + common + local + jitter);
}

// ---------------------------------------------------------------- endpoints

const nowSec = () => Date.now() / 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const ref = (c: DemoCountry) => ({ id: c.id, name: c.name, avatar: c.avatar });

const SELLERS = ["Aurum Holdings", "Iron Will Co", "Padaria Real", "Black Eagle", "Nova Industria", "Sunrise Ltd", "Red Star Works", "Atlas Trade", "Golden Mill", "Vanguard Corp", "Lusitania SA", "Danube Supply"];

function itemOffers(countryId: number, itemId: number, page: number) {
  const c = countryById.get(countryId);
  const item = itemById.get(itemId);
  if (!c || !item || demoIsEmpty(countryId, itemId)) return undefined;
  const t = nowSec();
  const best = demoGoldPrice(countryId, itemId, t) * demoFxRate(c.currencyId, t);
  const r = rng(hash("book", countryId, itemId, Math.floor(t / 600), page));
  const size = page === 1 ? 6 + Math.floor(unit("bs", countryId, itemId) * 20) : page === 2 ? Math.floor(r() * 10) : 0;
  const offers = [];
  let price = best * (1 + (page - 1) * 0.12);
  for (let k = 0; k < size; k++) {
    if (k > 0) price *= 1 + 0.002 + r() * 0.012;
    const sellerCountry = r() < 0.65 ? c : DEMO_COUNTRIES[Math.floor(r() * DEMO_COUNTRIES.length)];
    offers.push({
      id: hash("o", countryId, itemId, k, page) % 900000,
      value: Number(price.toFixed(4)),
      amount: Math.max(1, Math.round(r() ** 2 * (RAW_TYPES.has(item.type) ? 4000 : item.type === "AIRWEAPONS" ? 40 : 600))),
      owner: {
        id: 400 + Math.floor(r() * 500),
        type: r() < 0.5 ? "holding" : "account",
        name: SELLERS[Math.floor(r() * SELLERS.length)],
        avatar: null,
        country_id: sellerCountry.id,
      },
      item: { id: item.id, name: item.name, type: item.type, quality: item.quality, avatar: item.avatar },
      currency: { id: c.currencyId, name: c.currency, avatar: null },
      import_tax: { origin_country_id: sellerCountry.id, rate: sellerCountry.id === c.id ? 0 : c.importTax },
    });
  }
  return offers.length ? offers : undefined;
}

function coinOffers(currencyId: number, side: string, page: number) {
  if (!countryByCurrency.has(currencyId) || page > 1) return undefined;
  const t = nowSec();
  const rate = demoFxRate(currencyId, t);
  const r = rng(hash("coin", currencyId, side, Math.floor(t / 600)));
  // Like the live API: BUY quotes local per Gold, SELL quotes Gold per unit of local.
  const start = side === "SELL" ? 1 / (rate * 0.992) : rate * 1.008;
  const out = [];
  let x = start;
  for (let k = 0; k < 12; k++) {
    if (k > 0) x *= 1 + 0.001 + r() * 0.004;
    out.push({ id: 2300000 + k, rate: Number(x.toPrecision(5)), amount: Math.round(1 + r() * 60), owner: { id: 400 + k, type: "account", name: SELLERS[k % SELLERS.length], avatar_border: null } });
  }
  return out;
}

const WAR_EPOCH = 1_790_000_000; // fixed origin so round numbers advance over time
const ROUND_SEC = 2 * 3600;
// Attacker / defender are live country ids (see DEMO_COUNTRIES).
const DEMO_WARS = [
  { id: 901, a: 18, d: 23, region: "Vojvodina", offset: 0 },
  { id: 902, a: 7, d: 10, region: "Buenos Aires", offset: 3 },
  { id: 903, a: 31, d: 28, region: "Dobruja", offset: 7 },
  { id: 904, a: 14, d: 13, region: "Porto", offset: 2 },
  { id: 905, a: 21, d: 23, region: "Belgrade", offset: 5, revolution: true },
];

function warState(w: (typeof DEMO_WARS)[number], t: number) {
  const elapsed = Math.floor((t - WAR_EPOCH) / ROUND_SEC) + w.offset;
  const round = (elapsed % 15) + 1; // wars "restart" every 15 rounds in the demo
  let as = 0;
  let ds = 0;
  for (let k = 1; k < round; k++) {
    if (unit("rw", w.id, elapsed - round + k) < 0.5) as++;
    else ds++;
  }
  const cycleStart = t - ((t - WAR_EPOCH) % ROUND_SEC) - (round - 1) * ROUND_SEC;
  return { round, as, ds, roundId: w.id * 1000 + round, cycleStart, elapsed };
}

const FIGHTERS = ["Yamashiro Ren", "KapitanBomba", "Zalo-Ghur", "Coxinha Hero", "Brkul Poaro", "IceChip", "Slykre", "Dragon79", "LUCYFER666", "Mrovenn"];

/**
 * Rounds shaped like the live API: `*_score` is damage, `*_points` decides the
 * round, future rounds are listed with zeros, end dates are UTC.
 */
function demoRounds(w: (typeof DEMO_WARS)[number], t: number) {
  const s = warState(w, t);
  const progress = (t % ROUND_SEC) / ROUND_SEC;
  return Array.from({ length: s.round + 2 }, (_, k) => {
    const n = k + 1;
    const done = n < s.round;
    const live = n === s.round;
    const attWon = unit("rw", w.id, s.elapsed - s.round + n) < 0.5;
    const scale = done ? 1 : live ? progress : 0;
    const dmg = (seed: string, win: boolean) => Math.round((win ? 4e6 : 1.2e6) * (0.6 + unit(seed, w.id, n)) * scale);
    const pts = (win: boolean) => Math.round((done ? (win ? 4800 : unit("lp", w.id, n) * 1500) : (win ? 2400 : 600) * progress) / 10) * 10;
    const hero = (seed: string, d: number) => (d > 0 ? { id: 1000 + (hash(seed, w.id, n) % 900), username: FIGHTERS[hash(seed, w.id, n) % FIGHTERS.length], avatar: null, damage: Math.round(d * 0.35) } : null);
    const ad = dmg("ad", attWon);
    const dd = dmg("dd", !attWon);
    return {
      id: w.id * 1000 + n,
      end_date: fmtDate(s.cycleStart + n * ROUND_SEC),
      attackers_score: ad,
      defenders_score: dd,
      attackers_points: live || done ? pts(attWon) : 0,
      defenders_points: live || done ? pts(!attWon) : 0,
      attackers_hero: hero("ah", ad),
      defenders_hero: hero("dh", dd),
    };
  });
}

function wars() {
  const t = nowSec();
  return DEMO_WARS.map((w) => {
    const s = warState(w, t);
    return {
      id: w.id,
      attackers: ref(countryById.get(w.a)!),
      defenders: ref(countryById.get(w.d)!),
      region: { id: w.d * 100 + 1, name: w.region },
      attackers_score: s.as,
      defenders_score: s.ds,
      current_round_number: s.round,
      current_round_id: s.roundId,
      flags: { is_revolution: w.revolution ? 1 : 0, is_civil_war: false },
      current_round: demoRounds(w, t)[s.round - 1],
    };
  });
}

function warRounds(warId: number) {
  const w = DEMO_WARS.find((x) => x.id === warId);
  return w ? demoRounds(w, nowSec()) : undefined;
}

function nukes() {
  const t = nowSec();
  const out = [];
  // [slot, period, from country, target region] — regions are `countryId * 100 + n`.
  for (const [slot, period, from, to] of [[0, 2400, 18, 2301], [1, 3700, 31, 2802]] as const) {
    const launched = Math.floor((t - slot * 900) / period) * period + slot * 900;
    const duration = 1200;
    if (t < launched + duration + 30) {
      out.push({ nuke_id: 400 + Math.floor(launched / period), from_country_id: from, from_region_id: from * 100 + 1, to_region_id: to, launched_at: launched, impact_at: launched + duration, duration_seconds: duration, server_time: t, timestamp: t });
    }
  }
  return { snapshot_timestamp: t, server_time: t, nukes: out };
}

function worldEvents() {
  const t = nowSec();
  const r = rng(hash("events", Math.floor(t / 900)));
  const pick = () => DEMO_COUNTRIES[Math.floor(r() * DEMO_COUNTRIES.length)];
  // Like the live API: a short title per event type plus an HTML sentence (ids are live event types).
  const templates: [number, string, (a: string, b: string) => string][] = [
    [1, "New war started", (a, b) => `${a} started a new war against ${b}.`],
    [7, "New invasion started", (a, b) => `${a} started a new invasion against ${b}.`],
    [24, "President elected", (a) => `A new president was elected in ${a}.`],
    [23, "Non-aggression pact signed", (a, b) => `${a} and ${b} signed a non-aggression pact.`],
    [21, "Nuclear strike launched", (a, b) => `${a} launched a nuclear strike against ${b}.`],
    [12, "Construction finished", (a) => `${a} just finished a construction.`],
    [14, "Earthquake", (a) => `An earthquake has struck a region of ${a}.`],
  ];
  const events = Array.from({ length: 20 }, (_, k) => {
    const [type, title, tpl] = templates[Math.floor(r() * templates.length)];
    const a = pick();
    let b = pick();
    if (b.id === a.id) b = DEMO_COUNTRIES[(DEMO_COUNTRIES.indexOf(a) + 1) % DEMO_COUNTRIES.length];
    const content = `<strong>${tpl(a.name, b.name)}</strong>`; // the app strips the HTML
    return { id: type, image_id: type, title, content, created_at: fmtDate(t - 300 - k * (600 + r() * 1800)), nuke_id: type === 21 ? 400 + k : null };
  });
  return { events, countries: DEMO_COUNTRIES.map(ref), event_types: [], pagination: { current_page: 1, total_pages: 1, per_page: 25, total_records: events.length } };
}

export function mockTransport(path: string, params: Params): unknown {
  const n = (k: string, d = 0) => {
    const v = Number(params[k]);
    return Number.isFinite(v) && v !== 0 ? v : d;
  };
  const page = n("page", 1);
  const t = nowSec();

  switch (path) {
    case "/server/status": {
      const d = new Date(t * 1000);
      return [{ status: "ok", version: "1.3.0", server_name: "Eclesiar (demo)", server_time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`, server_day: Math.floor((t * 1000 - Date.UTC(2024, 8, 29)) / 86_400_000) }];
    }
    case "/server/items":
      return page === 1 ? DEMO_ITEMS.map((i) => ({ id: i.id, name: i.name, quality: i.quality, type: i.type, negotiable: true, avatar: i.avatar })) : undefined;
    case "/countries":
      return DEMO_COUNTRIES.map((c) => ({
        id: c.id,
        name: c.name,
        avatar: c.avatar,
        currency: { id: c.currencyId, name: c.currency, symbol: null },
        is_available: true,
        laws: { work_tax: c.workTax, vat: c.vat, import_taxes: c.importTax, minimum_wage: c.minWage },
      }));
    case "/statistics/country":
      return [...DEMO_COUNTRIES].sort((a, b) => b.active - a.active).map((c) => ({ country: ref(c), value: c.active }));
    case "/country/regions": {
      const c = countryById.get(n("country_id"));
      return c?.regions.map((name, k) => ({ id: c.id * 100 + k + 1, name, country_id: c.id }));
    }
    case "/market/items/get":
      return itemOffers(n("country_id"), n("item_id"), page);
    case "/market/coin/get":
      return coinOffers(n("currency_id"), String(params.transaction ?? "BUY"), page);
    case "/wars":
      return page === 1 ? wars() : undefined;
    case "/war/rounds":
      return warRounds(n("war_id"));
    case "/nukes/active":
      return nukes();
    case "/world/events":
      return worldEvents();
    default:
      return undefined;
  }
}
