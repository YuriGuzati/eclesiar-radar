/** Response shapes of our own /api/* routes, shared by server and client. */

export interface CountryInfo {
  id: number;
  name: string;
  avatar: string | null;
  currencyId: number | null;
  currency: string | null;
  importTax: number | null;
  vat: number | null;
  active: number | null;
}

export interface ItemInfo {
  id: number;
  name: string;
  type: string;
  quality: number;
  avatar: string | null;
}

export interface OverviewItem extends ItemInfo {
  bestGold: number | null;
  bestCountryId: number | null;
  bestLocal: number | null;
  medianGold: number | null;
  markets: number;
  change24h: number | null;
  spark: number[];
}

export interface Overview {
  updatedAt: number | null;
  countries: CountryInfo[];
  items: OverviewItem[];
}

export interface MarketRow {
  countryId: number;
  bestLocal: number | null;
  bestGold: number | null;
  depth: number;
  offers: number;
  updatedAt: number;
  change24h: number | null;
}

export interface BookOffer {
  p: number;
  a: number;
  s: string | null;
  sc: number | null;
  tx: number | null;
}

export interface ItemMarkets {
  itemId: number;
  rows: MarketRow[];
  book: { countryId: number; updatedAt: number; offers: BookOffer[] } | null;
}

export interface CandleDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface History {
  itemId: number;
  countryId: number | null;
  unit: "gold" | "local";
  tf: Timeframe;
  candles: CandleDto[];
}

export type Timeframe = "15m" | "1h" | "4h" | "1d";

export interface FxRow {
  currencyId: number;
  currency: string;
  countryIds: number[];
  buy: number | null;
  sell: number | null;
  /** null when the book has no trustworthy price (see MAX_FX_SPREAD). */
  mid: number | null;
  spread: number | null;
  change24h: number | null;
  spark: number[];
  updatedAt: number;
}

export interface ArbRow {
  item: ItemInfo;
  buyCountryId: number;
  buyGold: number;
  buyUnits: number;
  sellCountryId: number;
  sellGold: number;
  listGold: number;
  netGold: number;
  taxPct: number;
  grossPct: number;
  netPct: number;
  profitGold: number;
  buyAge: number;
  sellAge: number;
}

export interface WarSide {
  id: number;
  name: string;
  avatar: string | null;
}

export interface HeroDto {
  id: number;
  name: string | null;
  avatar: string | null;
  damage: number;
}

export interface RoundDto {
  id: number;
  /** Unix seconds. */
  endsAt: number | null;
  attackersDamage: number;
  defendersDamage: number;
  /** The round goes to the side with more points. */
  attackersPoints: number;
  defendersPoints: number;
  attackersHero: HeroDto | null;
  defendersHero: HeroDto | null;
}

export interface WarDto {
  id: number;
  attackers: WarSide;
  defenders: WarSide;
  region: string | null;
  /** Rounds won. */
  attackersScore: number;
  defendersScore: number;
  round: number | null;
  roundId: number | null;
  revolution: boolean;
  civilWar: boolean;
  current: RoundDto | null;
}

export interface WarDetail {
  id: number;
  rounds: (RoundDto & { number: number; status: "done" | "live" | "scheduled"; winner: "att" | "def" | null })[];
}

export interface NukeDto {
  id: number;
  fromCountryId: number | null;
  fromCountry: string | null;
  toRegion: string | null;
  toCountry: string | null;
  launchedAt: number;
  impactAt: number;
}

export interface EventDto {
  type: number | null;
  title: string;
  text: string;
  /** Unix seconds. */
  createdAt: number | null;
  nukeId: number | null;
}

export interface Status {
  mode: "demo" | "live";
  db: "pglite" | "postgres" | "neon";
  server: { day: number | null; time: string | null; version: string | null } | null;
  usageToday: number;
  dailyLimit: number;
  lastRun: { startedAt: number; finishedAt: number | null; requests: number; tasks: number; errors: number; note: string | null } | null;
  coverage: { markets: number; withOffers: number; fresh: number };
  autoIngestMinutes: number;
}
