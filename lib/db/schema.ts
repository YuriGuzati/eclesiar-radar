/**
 * Database schema (SQLite / Cloudflare D1), applied idempotently on first use.
 *
 * Shaped around D1's Free-plan quotas (100k rows written and 5M rows read per
 * day, where every index entry counts as an extra write and every scanned row
 * as a read):
 * - timestamps are Unix seconds (INTEGER); JSON is TEXT;
 * - the big tables are WITHOUT ROWID with the primary key as the only index, so
 *   each insert is one written row and range queries read only what they return;
 * - pages read precomputed `snapshots` instead of scanning tables.
 */
export const SCHEMA = /* sql */ `
create table if not exists meta (
  key   text primary key,
  value text not null
) without rowid;

create table if not exists countries (
  id              integer primary key,
  name            text not null,
  avatar          text,
  currency_id     integer,
  currency_name   text,
  import_tax      real,
  vat             real,
  work_tax        real,
  min_wage        real,
  active_citizens integer,
  is_available    integer,
  updated_at      integer not null
);

create table if not exists items (
  id         integer primary key,
  name       text not null,
  type       text not null default 'OTHER',
  quality    integer not null default 0,
  avatar     text,
  -- Whether the item trades on the national item markets (collector + UI only use these).
  tradable   integer not null default 1,
  updated_at integer not null
);

create table if not exists regions (
  id         integer primary key,
  name       text not null,
  country_id integer,
  updated_at integer not null
);

-- Latest first page of each (item, country) order book. Gold values are derived
-- at read time from the current exchange rate.
create table if not exists market_latest (
  item_id     integer not null,
  country_id  integer not null,
  ts          integer not null,
  currency_id integer,
  best_local  real,
  depth       integer not null default 0,
  offers      integer not null default 0,
  book        text not null default '[]',
  sampled_at  integer not null default 0,
  primary key (item_id, country_id)
) without rowid;

-- Price history per market: written when the best ask changes (or every few hours).
create table if not exists market_samples (
  item_id    integer not null,
  country_id integer not null,
  ts         integer not null,
  best_local real not null,
  best_gold  real,
  depth      integer not null,
  offers     integer not null,
  primary key (item_id, country_id, ts)
) without rowid;

-- Currency market, both sides stored as local currency per 1 Gold.
create table if not exists fx_latest (
  currency_id integer primary key,
  ts          integer not null,
  buy_rate    real,
  sell_rate   real,
  buy_depth   real,
  sell_depth  real
);

create table if not exists fx_samples (
  currency_id integer not null,
  ts          integer not null,
  buy_rate    real,
  sell_rate   real,
  primary key (currency_id, ts)
) without rowid;

-- Per-item global index (cheapest market in Gold + median), every ~10 minutes.
create table if not exists index_samples (
  item_id         integer not null,
  ts              integer not null,
  best_gold       real not null,
  median_gold     real,
  markets         integer not null,
  best_country_id integer,
  primary key (item_id, ts)
) without rowid;

-- Precomputed JSON payloads read by the pages (overview, fx, quotes).
create table if not exists snapshots (
  key  text primary key,
  ts   integer not null,
  json text not null
) without rowid;

create table if not exists api_usage (
  day      text primary key,
  requests integer not null default 0
) without rowid;

create table if not exists ingest_runs (
  id          integer primary key,
  started_at  integer not null,
  finished_at integer,
  requests    integer not null default 0,
  tasks       integer not null default 0,
  errors      integer not null default 0,
  note        text
);
`;

/** Tables holding collected data (wiped when switching between demo and live data). */
export const DATA_TABLES = [
  "countries",
  "items",
  "regions",
  "market_latest",
  "market_samples",
  "fx_latest",
  "fx_samples",
  "index_samples",
  "snapshots",
  "ingest_runs",
] as const;

/**
 * Splits a multi-statement SQL script into single statements (D1 runs one
 * statement per prepared query). Comment-only chunks are dropped. Our schema
 * has no semicolons inside strings or bodies, so a plain split is safe.
 */
export function schemaStatements(script: string = SCHEMA): string[] {
  return script
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim().length > 0);
}
