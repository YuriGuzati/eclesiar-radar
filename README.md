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
and icons, while prices, wars and events are synthetic. Demo data lives in a separate database and
never mixes with real data.

Flags and item icons are loaded from the game's own CDN (the URLs the API returns); none are
bundled in this repository.

### Connecting the real API

1. Log in to Eclesiar and open <https://eclesiar.com/api> → **Generate New Key**.
2. Create a `.env.local` file (see [`.env.example`](.env.example)) with:

   ```
   ECLESIAR_API_KEY=your_key
   ```

3. Restart `pnpm dev`. The collector starts by itself within a few seconds and runs every 10 min.
   To fill everything in one go the first time:

   ```bash
   curl -X POST "http://localhost:3000/api/ingest?budget=2000"
   ```

The key stays **on the server only**: the browser only talks to the app's own `/api/*` routes.

## How it works

```
Browser ──poll 15–60s──▶ /api/* (Next.js) ──reads──▶ Postgres (local PGlite or DATABASE_URL)
                               │                          ▲
                               └─ wars/nukes/events       │ writes samples
                                  (in-memory cache)       │
                   collector (every 10 min) ──────────────┘──▶ api.eclesiar.com
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
  (`INGEST_BUDGET`, default 180) and spends it on the most overdue tasks: reference data first,
  then exchange rates, then markets. Countries with the most active citizens are refreshed every
  30 min, mid-sized ones every 90 min and the rest every 6 h. Markets that stay empty or keep
  failing back off exponentially. There's also a daily cap (`DAILY_REQUEST_LIMIT`, default 40,000)
  to leave headroom for the live pages. Today's usage is shown in the footer.
- **Own history.** The API has no trade history, so candles are built from the collector's
  samples. After every run a per-item index is stored (world's cheapest price in Gold + median),
  which feeds the global chart, the ticker and the 24h changes. Samples are kept for 60 days.
- **Live data without a database.** Wars, rounds, nukes and events come straight from the API
  with an in-memory cache (10–60 s) and stale-while-revalidate, so many viewers generate few
  calls. `/wars` with `extra_details=1` already includes the current round (damage, points,
  heroes). In rounds, `*_score` is the **damage** and the side with more `*_points` wins. API
  timestamps are UTC; the UI shows them in the viewer's time zone. `/nukes/active` doesn't even
  need a key.

```
lib/
├─ eclesiar/   client (fetch + Bearer + 429) · schemas (zod) · endpoints · mock (demo mode)
├─ ingest/     scheduler (budget) · run (collector) · auto (timer) · demo-backfill
├─ domain/     fx · ohlc (candles, SMA) · arbitrage      ← pure functions, with tests
├─ db/         PGlite or postgres.js · schema (automatic migration)
├─ queries.ts  read models for the /api/* routes
components/    market/ · arbitrage/ · war/ · AppShell · ui
app/           pages + app/api/*
```

## Environment variables

| Variable | Purpose |
|---|---|
| `ECLESIAR_API_KEY` | API key. Without it: demo mode (local only) |
| `DATABASE_URL` | Postgres (Neon, Supabase…). Without it: embedded PGlite in `./.data/`. Required on Cloudflare |
| `INGEST_SECRET` | Token required by `/api/ingest` in production (the Cloudflare cron sends it) |
| `AUTO_INGEST_MINUTES` | In-process collector interval (default 10; 0 turns it off; off on Vercel/Cloudflare) |
| `INGEST_BUDGET` | Requests per collector run (default 180; 20 on Cloudflare Free, see `wrangler.jsonc`) |
| `DAILY_REQUEST_LIMIT` | Daily cap on collector requests (default 40,000) |
| `INGEST_CONCURRENCY` | Parallel requests while collecting (default 4) |

## Deployment

### Cloudflare Workers + Neon (recommended)

The app runs on Workers through the [OpenNext adapter](https://opennext.js.org/cloudflare), with
a [Neon](https://neon.com) Postgres database (free tiers of both are enough to start). A Cron
Trigger (in [`wrangler.jsonc`](wrangler.jsonc)) calls `/api/ingest` every minute through the small
wrapper in [`cloudflare-worker.js`](cloudflare-worker.js).

How it differs from running locally:

- **Database:** Workers have no disk, so PGlite isn't used (it's stubbed out of the bundle). The app
  talks to Neon with its HTTP driver; each query is a stateless `fetch`.
- **Collector:** no in-process timer; the cron drives it. It's sized for the Free plan, which allows
  50 subrequests per invocation (every API call *and* every Neon query counts): 20 API requests and
  about 15 queries per run, every minute, which comes to at most ~28k API requests a day. On Workers
  Paid you can switch to `*/10 * * * *` with `INGEST_BUDGET` 180.
- **Cache Components** are off: the adapter doesn't fully support them yet, and the app doesn't need them.

**1. Create the database.** Sign up at [neon.com](https://neon.com), create a project in a region
close to your players, and copy its **pooled** connection string (it looks like
`postgresql://user:pass@ep-…-pooler.region.aws.neon.tech/neondb?sslmode=require`). The tables are
created automatically on the first request.

**2. Create the Worker from GitHub** (Cloudflare builds it on Linux, which avoids the Windows
limitation below). In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**,
pick this repo, and set:

| Setting | Value |
|---|---|
| Project name | `eclesiar-radar` (must match `name` in `wrangler.jsonc`) |
| Build command | `pnpm cf:build` |
| Deploy command | `pnpm exec opennextjs-cloudflare deploy` |

Every push to `main` then rebuilds and redeploys.

**3. Add the secrets.** In the Worker: **Settings → Variables and Secrets**, add three entries of
type *Secret*:

| Name | Value |
|---|---|
| `ECLESIAR_API_KEY` | your key from <https://eclesiar.com/api> |
| `DATABASE_URL` | the Neon connection string |
| `INGEST_SECRET` | any long random string |

Secrets survive redeploys. Don't commit them anywhere (`.env*` and `.dev.vars` are git-ignored).

**4. Open the site** at the `*.workers.dev` URL shown in the dashboard (you can attach your own
domain under **Settings → Domains & Routes**). The first data shows up within a couple of minutes,
and with 20 requests a minute every market has been read after about an hour. The collector's logs
are under **Observability**.

**Deploying from your own machine** also works (`pnpm exec wrangler login`, then `pnpm cf:deploy`)
on macOS, Linux or WSL. On plain Windows the OpenNext build stops with `EPERM … symlink` unless
Windows Developer Mode is on, which is why the GitHub build is the default here. Note that a local
build embeds the values of your `.env*` files as fallbacks, so prefer the dashboard secrets.

To try the Worker locally, put test values in a `.dev.vars` file (same names as above) and run
`pnpm cf:preview`.

### Own server / VPS

`pnpm build && pnpm start`. The collector runs inside the process and PGlite stores everything in
`./.data/` (or set `DATABASE_URL` to use Postgres).

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server (Node) |
| `pnpm cf:build` | Cloudflare Workers build (OpenNext) |
| `pnpm cf:preview` | Build and run the Worker locally in workerd |
| `pnpm cf:deploy` | Build and deploy the Worker with Wrangler |
| `pnpm test` | Tests (Vitest) for the domain functions, the scheduler and the schema |
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
