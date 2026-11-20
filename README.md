# Eclesiar Radar

A fan-made market and war radar for [Eclesiar](https://eclesiar.com): prices from every national
market converted to **Gold**, candlestick charts, order books, currency exchange rates,
**cross-country arbitrage**, active wars, nuclear strikes in flight and world events.

Built on the official Eclesiar public API. Not affiliated with Eclesiar.

## Pages

| Page | What it shows |
|---|---|
| `/` Market | Ticker with the biggest 24h moves · item list with the world's cheapest price in Gold · candles (15M/1H/4H/1D) with a moving average, global or per country (in Gold or local currency) · every market for the selected item · order book for the chosen country · exchange rates for every currency, flagging illiquid ones |
| `/arbitrage` | For each item: where to buy cheapest and where to sell, after the destination's import tax (zero if the destination is your citizenship), available quantity and estimated profit |
| `/wars` | Active wars with score and round countdown · current round with points, damage and each side's hero · round history with winners · nuclear strikes in flight with countdown · world events feed |

## Running

Requires **Node 20+** and **pnpm**.

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Without an API key the app starts in **DEMO mode** (marked with a `DEMO` badge at the top) and
already shows a week of history. The demo uses the game's real countries, currencies, items, flags
and icons, while prices, wars and events are synthetic. Switching between demo and live mode clears
the collected data, so the two never mix.

The database is [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite). Under `pnpm dev`
there's nothing to set up: Wrangler simulates it locally in `.wrangler/state` (delete that folder to
start over).

Flags and item icons are loaded from the game's own CDN (the URLs the API returns); none are
bundled in this repository.

### Connecting the real API

1. Log in to Eclesiar and open <https://eclesiar.com/api> → **Generate New Key**.
2. Create a `.env.local` file (see [`.env.example`](.env.example)) with:

   ```
   ECLESIAR_API_KEY=your_key
   ```

3. Restart `pnpm dev`. The collector starts by itself within a few seconds and runs every 10 min.
   To fill everything in one go the first time (about 1,300 requests):

   ```bash
   curl -X POST "http://localhost:3000/api/ingest?budget=1500"
   ```

The key stays **on the server only**: the browser only talks to the app's own `/api/*` routes.

## How it works

```
Browser ──poll 15–60s──▶ /api/* (Next.js) ──reads──▶ D1 (snapshots + samples)
                               │                          ▲
                               └─ wars/nukes/events       │ writes prices, rebuilds snapshots
                                  (in-memory cache)       │
          collector (cron every 2 min / timer in dev) ────┘──▶ api.eclesiar.com
```

- **Every market is a country.** An item has one order book per country, each in its own
  currency. The collector reads the top of each book and converts it to Gold through the currency
  market. Mind the real API format: on the `BUY` side the rate is *currency per 1 Gold*
  (BRL ≈ 10.99), while on the `SELL` side it is *Gold per 1 unit of currency* (≈ 0.100). The app
  normalizes both to currency per Gold and uses the average. **Illiquid currencies** (sides more
  than 2× apart, like NIS 100 vs 0.22) have no trustworthy price: their markets show the local
  price but are left out of the Gold conversion, the global index and arbitrage (tunable via
  `MAX_FX_SPREAD` in [lib/domain/fx.ts](lib/domain/fx.ts)).
- **Market items.** Consumables (tanks, adrenaline, permits…) never appear on the national
  markets, so the collector only reads the ~24 economy items (food, weapons, aircraft, tickets and
  raw materials). With the current 45 countries that's ~1,100 order books.
- **Request budget.** The API allows 50,000 requests per day per account, and each
  country × item pair costs one. The [scheduler](lib/ingest/scheduler.ts) gives every run a budget
  (`INGEST_BUDGET`, default 30) and spends it on the most overdue tasks: reference data first,
  then exchange rates, then markets. Countries with the most active citizens are refreshed every
  30 min, mid-sized ones every 90 min and the rest every 6 h. Markets that stay empty or keep
  failing back off exponentially. There's also a daily cap (`DAILY_REQUEST_LIMIT`, default 40,000)
  to leave headroom for the live pages. Today's usage is shown in the footer.
- **Own history.** The API has no trade history, so candles are built from the collector's
  samples. A price is sampled when the best ask changes (or every 3 h if it doesn't), and gaps are
  drawn as flat candles. Every ~10 minutes a per-item index is stored (world's cheapest price in
  Gold + median), which feeds the global chart, the ticker and the 24h changes. Market samples are
  kept for 30 days, the index and exchange rates for 60.
- **Snapshots.** D1 bills by rows read and written, so the collector precomputes the overview,
  exchange rates and arbitrage quotes into one JSON row each (every ~10 min). A page view reads a
  single row instead of scanning ~1,100 markets, and all of a run's writes go in one batch.
- **Live data without a database.** Wars, rounds, nukes and events come straight from the API
  with an in-memory cache (10–60 s) and stale-while-revalidate, so many viewers generate few
  calls. `/wars` with `extra_details=1` already includes the current round (damage, points,
  heroes). In rounds, `*_score` is the **damage** and the side with more `*_points` wins. API
  timestamps are UTC; the UI shows them in the viewer's time zone. `/nukes/active` doesn't even
  need a key.

```
lib/
├─ eclesiar/   client (fetch + Bearer + 429) · schemas (zod) · endpoints · mock (demo mode)
├─ ingest/     scheduler (budget) · run (collector) · snapshots · auto (dev timer) · demo-backfill
├─ domain/     fx · ohlc (candles, SMA) · arbitrage      ← pure functions, with tests
├─ db/         D1 binding · schema (automatic migration) · SQL helpers
├─ queries.ts  read models for the /api/* routes
components/    market/ · arbitrage/ · war/ · AppShell · ui
app/           pages + app/api/*
```

## Environment variables

| Variable | Purpose |
|---|---|
| `ECLESIAR_API_KEY` | API key. Without it: demo mode (local only) |
| `INGEST_SECRET` | Token required by `/api/ingest` in production (the Cloudflare cron sends it) |
| `AUTO_INGEST_MINUTES` | Collector interval under `pnpm dev` (default 10; 0 turns it off; always off on Workers) |
| `INGEST_BUDGET` | Requests per collector run (default 30, see `wrangler.jsonc`) |
| `DAILY_REQUEST_LIMIT` | Daily cap on collector requests (default 40,000) |
| `INGEST_CONCURRENCY` | Parallel requests while collecting (default 4) |

## Deployment

### Cloudflare Workers + D1

The app runs on Workers through the [OpenNext adapter](https://opennext.js.org/cloudflare), with a
D1 database bound as `DB`. Both fit the free plan. A Cron Trigger (in [`wrangler.jsonc`](wrangler.jsonc))
calls `/api/ingest` every 2 minutes through the small wrapper in
[`cloudflare-worker.js`](cloudflare-worker.js).

Why it fits the free plan:

- **Subrequests:** Workers Free allows 50 external requests per invocation. D1 queries don't count
  towards that, so each run spends 30 API requests (`INGEST_BUDGET`). Every 2 minutes that's about
  21k requests a day, under the API's 50k.
- **D1 quotas:** the free plan gives 5M rows read and 100k rows written per day. Sampling only on
  change, batching each run's writes and serving pages from snapshots keeps the collector around
  40–50k writes and well under 1M reads a day.
- **Cache Components** are off: the adapter doesn't fully support them yet, and the app doesn't need them.

**1. Create the Worker from GitHub.** Cloudflare builds it on Linux, which avoids the Windows
limitation below. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a
repository**, pick this repo, and set:

| Setting | Value |
|---|---|
| Project name | `eclesiar-radar` (must match `name` in `wrangler.jsonc`) |
| Build command | `pnpm cf:build` |
| Deploy command | `pnpm exec opennextjs-cloudflare deploy` |

The first deploy **creates the D1 database** (`eclesiar-radar`) and binds it, because
`wrangler.jsonc` lists it without a `database_id`. The tables are created on the first request.
Every push to `main` then rebuilds and redeploys, and keeps the data.

> If the deploy log complains about the database instead, create it by hand in **Storage &
> Databases → D1 → Create** with the name `eclesiar-radar`. Then paste its ID into
> `wrangler.jsonc` as `"database_id"` and push.

**2. Add the secrets.** In the Worker, open **Settings → Variables and Secrets** and add two
entries of type *Secret*:

| Name | Value |
|---|---|
| `ECLESIAR_API_KEY` | your key from <https://eclesiar.com/api> |
| `INGEST_SECRET` | any long random string |

Secrets survive redeploys. Don't commit them anywhere (`.env*` and `.dev.vars` are git-ignored).

**3. Open the site** at the `*.workers.dev` URL shown in the dashboard. You can attach your own
domain under **Settings → Domains & Routes**. Reference data and exchange rates come in on the first
cron run and prices on the next ones. At 30 requests every 2 minutes, every market has been read
after about 1.5 hours. The collector's logs are under **Observability**, and you can browse the
tables in **Storage & Databases → D1**.

**Deploying from your own machine** also works on macOS, Linux or WSL: run
`pnpm exec wrangler login`, then `pnpm cf:deploy`. On plain Windows the OpenNext build stops with
`EPERM … symlink` unless Windows Developer Mode is on, which is why the GitHub build is the default
here. A local build embeds the values of your `.env*` files as fallbacks, so prefer the dashboard
secrets.

To try the Worker locally, put test values in a `.dev.vars` file (same names as above) and run
`pnpm cf:preview`.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Next.js production build (used by `cf:build`) |
| `pnpm cf:build` | Cloudflare Workers build (OpenNext) |
| `pnpm cf:preview` | Build and run the Worker locally in workerd |
| `pnpm cf:deploy` | Build and deploy the Worker with Wrangler |
| `pnpm test` | Tests (Vitest) for the domain functions, the scheduler, the schema and the SQL helpers |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |

## Known limitations

- Arbitrage is an estimate based on sell offers only (the API doesn't expose item buy orders).
  To avoid showing fake opportunities, it ignores destinations whose ask is above 2× the item's
  median (“parked” listings) and, by default, destinations with fewer than 20 active citizens.
  It doesn't account for VAT, travel, exchange-rate spread or how fast items sell.
- History (candles, 24h change) only exists from the moment the collector starts running. Use the
  15-minute candles during the first hours.
- Currencies with a spread between 1.5× and 2× (e.g. ARS) are converted at the average and may be
  somewhat off.
- Workers Free also caps CPU time at 10 ms per request. If **Observability** shows "Exceeded CPU
  limit" errors, lower `INGEST_BUDGET` or move to Workers Paid.
