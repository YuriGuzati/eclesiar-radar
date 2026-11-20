/**
 * Database schema, applied automatically (idempotently) on first connection.
 * Works on any Postgres: the embedded PGlite used locally, Supabase, Neon, etc.
 *
 * Volume estimate at the default budget (~180 requests per 10-min run):
 *   market_samples ≈ 25k rows/day → pruned after RETENTION_DAYS (lib/ingest/run.ts).
 */
export const SCHEMA = /* sql */ `
create table if not exists countries (
  id              int primary key,
  name            text not null,
  avatar          text,
  currency_id     int,
  currency_name   text,
  import_tax      double precision,
  vat             double precision,
  work_tax        double precision,
  min_wage        double precision,
  active_citizens int,
  is_available    boolean,
  updated_at      timestamptz not null default now()
);

create table if not exists items (
  id         int primary key,
  name       text not null,
  type       text not null default 'OTHER',
  quality    int not null default 0,
  avatar     text,
  updated_at timestamptz not null default now()
);
-- Whether the item trades on the national item markets (collector + UI only use these).
alter table items add column if not exists tradable boolean not null default true;

create table if not exists regions (
  id         int primary key,
  name       text not null,
  country_id int,
  updated_at timestamptz not null default now()
);

-- One row per (country, item) sampling of the first order-book page.
create table if not exists market_samples (
  ts         timestamptz not null,
  country_id int not null,
  item_id    int not null,
  best_local double precision not null,
  best_gold  double precision,
  depth      int not null,
  offers     int not null,
  primary key (item_id, country_id, ts)
);
create index if not exists market_samples_ts_idx on market_samples (ts);

-- Latest known order book per (country, item); best_* null = empty market.
create table if not exists market_latest (
  country_id int not null,
  item_id    int not null,
  ts         timestamptz not null,
  best_local double precision,
  best_gold  double precision,
  depth      int not null default 0,
  offers     int not null default 0,
  book       jsonb not null default '[]',
  primary key (country_id, item_id)
);

-- Currency market: rate = units of local currency per 1 Gold.
create table if not exists fx_samples (
  ts          timestamptz not null,
  currency_id int not null,
  buy_rate    double precision,
  sell_rate   double precision,
  primary key (currency_id, ts)
);
create table if not exists fx_latest (
  currency_id int primary key,
  ts          timestamptz not null,
  buy_rate    double precision,
  sell_rate   double precision,
  buy_depth   double precision,
  sell_depth  double precision
);

-- Per-item global index computed after each run: cheapest market in Gold + median.
create table if not exists index_samples (
  ts              timestamptz not null,
  item_id         int not null,
  best_gold       double precision not null,
  median_gold     double precision,
  markets         int not null,
  best_country_id int,
  primary key (item_id, ts)
);
create index if not exists index_samples_ts_idx on index_samples (ts);

-- Collector bookkeeping.
create table if not exists task_state (
  key          text primary key,
  last_run     timestamptz not null,
  empty_streak int not null default 0,
  fail_streak  int not null default 0
);
create table if not exists api_usage (
  day      text primary key,
  requests int not null default 0
);
create table if not exists ingest_runs (
  id          serial primary key,
  started_at  timestamptz not null,
  finished_at timestamptz,
  requests    int not null default 0,
  tasks       int not null default 0,
  errors      int not null default 0,
  note        text
);
`;

/**
 * Splits a multi-statement SQL script into single statements, for drivers that
 * take one statement per call (Neon over HTTP). Comment-only chunks are dropped.
 * Our schema has no semicolons inside strings or bodies, so a plain split is safe.
 */
export function schemaStatements(script: string = SCHEMA): string[] {
  return script
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim().length > 0);
}
