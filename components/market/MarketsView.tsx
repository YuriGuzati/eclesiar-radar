"use client";

import { useMemo, useState } from "react";
import { useCountries, useFx, useHistory, useItemMarkets, useNow, useOverview } from "@/lib/hooks";
import { ago, category, categoryRank, compact, decimalsFor, int, itemLabel, pct, price } from "@/lib/format";
import type { CountryInfo, FxRow, ItemMarkets, OverviewItem, Timeframe } from "@/lib/types";
import { CountryName, Delta, Empty, Flag, Loading, Panel, QueryState, Segmented, Spark } from "@/components/ui";
import { CandleChart } from "./CandleChart";
import { ItemIcon } from "./ItemIcon";

const G = () => <span className="ml-0.5 text-[0.85em] text-gold">G</span>;

export function MarketsView() {
  const overview = useOverview();
  const countries = useCountries();
  const [picked, setPicked] = useState<number | null>(null);
  const [chartCountry, setChartCountry] = useState<number | null>(null);
  const [bookCountry, setBookCountry] = useState<number | null>(null);

  const items = useMemo(() => overview.data?.items ?? [], [overview.data]);
  // Default selection: the biggest 24h mover that has markets.
  const selectedId = useMemo(() => {
    if (picked != null) return picked;
    const traded = items.filter((i) => i.bestGold != null);
    if (traded.length === 0) return null;
    return [...traded].sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0].id;
  }, [picked, items]);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const select = (id: number) => {
    setPicked(id);
    setBookCountry(null);
  };

  if (overview.data === undefined) {
    return (
      <div className="p-4">
        {overview.error ? <Empty>Failed to load the market: {String((overview.error as Error).message)}</Empty> : <Loading rows={10} />}
      </div>
    );
  }
  if (items.length === 0) {
    return <Empty>No items collected yet. The collector runs a few seconds after the server starts; wait for the first run.</Empty>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Ticker items={items} onPick={select} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-[260px_minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
        <ItemRail items={items} selectedId={selectedId} onPick={select} countries={countries} />

        <div className="grid min-h-0 min-w-0 grid-rows-[420px_auto] gap-2 lg:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {selected ? (
            <ChartPanel item={selected} countries={countries} country={chartCountry} onCountry={setChartCountry} />
          ) : (
            <Panel title="Chart">
              <Empty>Select an item.</Empty>
            </Panel>
          )}
          <MarketsPanel item={selected} countries={countries} bookCountry={bookCountry} onBookCountry={setBookCountry} />
        </div>

        <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto] gap-2 lg:grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <BookPanel item={selected} countries={countries} bookCountry={bookCountry} />
          <FxPanel countries={countries} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ticker

function Ticker({ items, onPick }: { items: OverviewItem[]; onPick: (id: number) => void }) {
  const movers = items
    .filter((i) => i.change24h != null && i.bestGold != null)
    .sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!))
    .slice(0, 16);
  if (movers.length === 0) return null;
  const row = [...movers, ...movers];
  return (
    <div className="ticker relative h-8 shrink-0 overflow-hidden border-b border-line bg-panel/60" aria-label="Biggest 24h moves">
      <div className="ticker-track flex w-max items-center gap-6 px-3 font-mono text-xs leading-8">
        {row.map((i, k) => (
          <button key={`${i.id}-${k}`} onClick={() => onPick(i.id)} className="flex items-center gap-2 whitespace-nowrap hover:text-gold" tabIndex={k < movers.length ? 0 : -1}>
            <ItemIcon item={i} size={14} />
            <span className="text-muted">{itemLabel(i)}</span>
            <span className="tnum">
              {price(i.bestGold)}
              <G />
            </span>
            <Delta value={i.change24h} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- item rail

function ItemRail({
  items,
  selectedId,
  onPick,
  countries,
}: {
  items: OverviewItem[];
  selectedId: number | null;
  onPick: (id: number) => void;
  countries: Map<number, CountryInfo>;
}) {
  const [q, setQ] = useState("");
  // Items with no offers in any market are hidden (e.g. special editions nobody sells).
  const traded = useMemo(() => items.filter((i) => i.bestGold != null), [items]);
  const hidden = items.length - traded.length;
  const groups = useMemo(() => {
    const filtered = traded.filter((i) => itemLabel(i).toLowerCase().includes(q.trim().toLowerCase()));
    const m = new Map<string, OverviewItem[]>();
    for (const i of filtered) m.set(category(i.type), [...(m.get(category(i.type)) ?? []), i]);
    return [...m].sort(([a], [b]) => categoryRank(a) - categoryRank(b));
  }, [traded, q]);

  return (
    <Panel title="Items · best price in Gold" className="max-h-[420px] lg:max-h-none" bodyClass="flex flex-col">
      <div className="border-b border-line p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter items…"
          aria-label="Filter items"
          className="w-full rounded border border-line bg-bg px-2 py-1 text-sm placeholder:text-dim focus:border-gold/60 focus:outline-none"
        />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && <Empty>Nothing found.</Empty>}
        {groups.map(([cat, list]) => (
          <div key={cat}>
            <div className="sticky top-0 z-10 bg-panel px-3 pt-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-dim uppercase">{cat}</div>
            {list.map((i) => {
              const active = i.id === selectedId;
              const where = i.bestCountryId != null ? countries.get(i.bestCountryId) : undefined;
              return (
                <button
                  key={i.id}
                  onClick={() => onPick(i.id)}
                  aria-pressed={active}
                  className={`grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2 border-l-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    active ? "border-gold bg-panel-2" : "border-transparent hover:bg-panel-2/60"
                  }`}
                >
                  <ItemIcon item={i} />
                  <span className="min-w-0">
                    <span className="block truncate">{itemLabel(i)}</span>
                    <span className="flex items-center gap-1 text-[11px] text-dim">
                      {where ? (
                        <>
                          <Flag country={where} size={10} /> <span className="truncate">{where.name}</span>
                        </>
                      ) : (
                        "no offers"
                      )}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5 font-mono text-xs">
                    <span className="tnum">
                      {price(i.bestGold)}
                      {i.bestGold != null && <G />}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Spark points={i.spark} width={40} height={12} />
                      <Delta value={i.change24h} className="text-[10px]" />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {hidden > 0 && <p className="px-3 py-2 text-[11px] text-dim">{hidden} items with no offers in any market are hidden.</p>}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- chart

function ChartPanel({
  item,
  countries,
  country,
  onCountry,
}: {
  item: OverviewItem;
  countries: Map<number, CountryInfo>;
  country: number | null;
  onCountry: (c: number | null) => void;
}) {
  const [tf, setTf] = useState<Timeframe>("1h");
  const [unit, setUnit] = useState<"gold" | "local">("gold");
  const hist = useHistory(item.id, country, tf, country == null ? "gold" : unit);
  const candles = hist.data?.candles ?? [];
  const last = candles.at(-1)?.close ?? item.bestGold ?? 0;
  const where = item.bestCountryId != null ? countries.get(item.bestCountryId) : undefined;
  const c = country != null ? countries.get(country) : undefined;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2 normal-case tracking-normal">
          <ItemIcon item={item} size={16} />
          <span className="text-sm font-semibold text-fg">{itemLabel(item)}</span>
        </span>
      }
      right={
        <div className="flex items-center gap-2">
          <select
            value={country ?? ""}
            onChange={(e) => onCountry(e.target.value === "" ? null : Number(e.target.value))}
            aria-label="Chart market"
            className="max-w-40 rounded border border-line bg-bg px-1.5 py-0.5 text-xs text-fg"
          >
            <option value="">Global (cheapest)</option>
            {[...countries.values()].map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </select>
          {country != null && (
            <Segmented
              label="Unit"
              value={unit}
              onChange={setUnit}
              options={[
                { value: "gold", label: "Gold" },
                { value: "local", label: c?.currency ?? "Local" },
              ]}
            />
          )}
          <Segmented
            label="Candle interval"
            value={tf}
            onChange={setTf}
            options={[
              { value: "15m", label: "15M" },
              { value: "1h", label: "1H" },
              { value: "4h", label: "4H" },
              { value: "1d", label: "1D" },
            ]}
          />
        </div>
      }
      bodyClass="flex flex-col"
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-3 pt-2 pb-1">
        <span className="font-mono text-2xl font-semibold tnum">
          {price(item.bestGold)}
          <G />
        </span>
        <Delta value={item.change24h} className="font-mono text-sm" />
        <span className="text-xs text-muted">
          cheapest in {where ? <CountryName country={where} size={11} /> : "—"}
          {item.bestLocal != null && where?.currency && (
            <span className="ml-1 font-mono">
              ({price(item.bestLocal)} {where.currency})
            </span>
          )}
        </span>
        <span className="text-xs text-muted">
          median {price(item.medianGold)}
          <G /> · {item.markets} markets
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {hist.data === undefined ? (
          hist.error ? <Empty>Failed to load history.</Empty> : <Loading rows={4} />
        ) : candles.length < 2 ? (
          <Empty>
            Not enough history for {c ? c.name : "this item"} at this interval yet. Candles fill in as the collector gathers samples (every 10 min)
            {tf !== "15m" ? "; try 15M" : ""}.
          </Empty>
        ) : (
          <CandleChart candles={candles} precision={decimalsFor(last)} />
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- markets per country

function MarketsPanel({
  item,
  countries,
  bookCountry,
  onBookCountry,
}: {
  item: OverviewItem | null;
  countries: Map<number, CountryInfo>;
  bookCountry: number | null;
  onBookCountry: (c: number) => void;
}) {
  const q = useItemMarkets(item?.id ?? null, null);
  const now = useNow(30_000);
  return (
    <Panel title={`Markets by country${item ? ` · ${itemLabel(item)}` : ""}`} bodyClass="scroll-thin overflow-auto">
      {!item ? (
        <Empty>Select an item.</Empty>
      ) : (
        <QueryState q={q} isEmpty={(d) => d.rows.length === 0} empty="No market read for this item yet.">
          {(d) => <MarketsTable data={d} countries={countries} now={now} bookCountry={bookCountry ?? d.book?.countryId ?? null} onPick={onBookCountry} />}
        </QueryState>
      )}
    </Panel>
  );
}

function MarketsTable({
  data,
  countries,
  now,
  bookCountry,
  onPick,
}: {
  data: ItemMarkets;
  countries: Map<number, CountryInfo>;
  now: number | null;
  bookCountry: number | null;
  onPick: (c: number) => void;
}) {
  const min = Math.min(...data.rows.filter((r) => r.bestGold != null).map((r) => r.bestGold!));
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-panel text-[10px] tracking-wider text-dim uppercase">
        <tr className="border-b border-line">
          <th className="px-3 py-1.5 text-left font-medium">Country</th>
          <th className="px-2 py-1.5 text-right font-medium" title="Best offer in the country's currency">Offer</th>
          <th className="px-2 py-1.5 text-right font-medium">Gold</th>
          <th className="hidden px-2 py-1.5 text-right font-medium whitespace-nowrap sm:table-cell">vs. best</th>
          <th className="px-2 py-1.5 text-right font-medium">24h</th>
          <th className="hidden px-2 py-1.5 text-right font-medium md:table-cell" title="Units on the first page of the book (up to 25 offers)">Stock</th>
          <th className="hidden px-3 py-1.5 text-right font-medium md:table-cell">Read</th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {data.rows.map((r) => {
          const c = countries.get(r.countryId);
          const active = r.countryId === bookCountry;
          const empty = r.offers === 0;
          const noFx = !empty && r.bestGold == null; // offers exist, but the currency has no trustworthy rate
          return (
            <tr
              key={r.countryId}
              onClick={() => !empty && onPick(r.countryId)}
              className={`border-b border-line/60 ${empty ? "text-dim" : "cursor-pointer hover:bg-panel-2"} ${active ? "bg-panel-2" : ""}`}
            >
              <td className={`px-3 py-1.5 font-sans text-sm ${active ? "text-gold" : ""}`}>
                <CountryName country={c} />
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap tnum">
                {empty ? "no offers" : `${price(r.bestLocal)} ${c?.currency ?? ""}`}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap tnum">
                {empty ? "—" : noFx ? (
                  <span className="text-dim" title="This currency's exchange is illiquid (buy and sell far apart), so the price isn't converted to Gold.">
                    no rate
                  </span>
                ) : (
                  <>
                    {price(r.bestGold)}
                    <G />
                  </>
                )}
              </td>
              <td className="hidden px-2 py-1.5 text-right tnum sm:table-cell">
                {r.bestGold == null ? "—" : r.bestGold === min ? <span className="text-gold">best</span> : `+${pct(((r.bestGold - min) / min) * 100, false)}`}
              </td>
              <td className="px-2 py-1.5 text-right">
                <Delta value={r.change24h} />
              </td>
              <td className="hidden px-2 py-1.5 text-right tnum md:table-cell">{empty ? "—" : compact(r.depth)}</td>
              <td className="hidden px-3 py-1.5 text-right text-dim md:table-cell">{ago(r.updatedAt, now)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- order book

function BookPanel({ item, countries, bookCountry }: { item: OverviewItem | null; countries: Map<number, CountryInfo>; bookCountry: number | null }) {
  const q = useItemMarkets(item?.id ?? null, bookCountry);
  const now = useNow(30_000);
  const book = q.data?.book ?? null;
  const c = book ? countries.get(book.countryId) : undefined;
  const row = q.data?.rows.find((r) => r.countryId === book?.countryId);
  const rate = row?.bestGold && row.bestLocal ? row.bestLocal / row.bestGold : null; // local per Gold
  // Running total of units, for the depth bars behind each price.
  const cumulative = (book?.offers ?? []).reduce<number[]>((acc, o) => [...acc, (acc.at(-1) ?? 0) + o.a], []);
  const maxCum = cumulative.at(-1) ?? 0;

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          Order book {c && <>· <CountryName country={c} size={11} /></>}
        </span>
      }
      right={book && <span className="font-mono text-[10px] text-dim">{ago(book.updatedAt, now)}</span>}
      className="max-h-[420px] lg:max-h-none"
      bodyClass="scroll-thin overflow-auto"
    >
      {!item ? (
        <Empty>Select an item.</Empty>
      ) : q.data === undefined ? (
        <Loading />
      ) : !book || book.offers.length === 0 ? (
        <Empty>No offers in this market.</Empty>
      ) : (
        <table className="w-full font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-panel text-[10px] tracking-wider text-dim uppercase">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 text-left font-medium">Price {c?.currency}</th>
              <th className="px-2 py-1.5 text-right font-medium">Gold</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-3 py-1.5 text-left font-medium">Seller</th>
            </tr>
          </thead>
          <tbody>
            {book.offers.map((o, k) => {
              const cum = cumulative[k];
              const seller = o.sc != null ? countries.get(o.sc) : undefined;
              return (
                <tr key={k} className="relative border-b border-line/40">
                  <td className="relative px-3 py-1 tnum text-down">
                    <span aria-hidden className="absolute inset-y-0 left-0 bg-down/10" style={{ width: `${(cum / maxCum) * 100}%` }} />
                    <span className="relative">{price(o.p)}</span>
                  </td>
                  <td className="px-2 py-1 text-right tnum text-muted">{rate ? price(o.p / rate) : "—"}</td>
                  <td className="px-2 py-1 text-right tnum">{int(o.a)}</td>
                  <td className="max-w-0 px-3 py-1 font-sans">
                    <span className="flex items-center gap-1.5" title={o.tx ? `Import tax for this seller: ${o.tx}%` : undefined}>
                      <Flag country={seller} size={10} />
                      <span className="truncate text-muted">{o.s ?? "—"}</span>
                      {o.tx ? <span className="shrink-0 text-[10px] text-war">{o.tx}%</span> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- currencies

function FxPanel({ countries }: { countries: Map<number, CountryInfo> }) {
  const q = useFx();
  return (
    <Panel title="Exchange · currency per 1 Gold" bodyClass="scroll-thin overflow-auto">
      <QueryState q={q} isEmpty={(d) => d.length === 0} empty="No exchange rates collected yet.">
        {(rows) => <FxTable rows={rows} countries={countries} />}
      </QueryState>
    </Panel>
  );
}

function FxTable({ rows, countries }: { rows: FxRow[]; countries: Map<number, CountryInfo> }) {
  return (
    <table className="w-full font-mono text-xs">
      <thead className="sticky top-0 z-10 bg-panel text-[10px] tracking-wider text-dim uppercase">
        <tr className="border-b border-line">
          <th className="px-3 py-1.5 text-left font-medium">Currency</th>
          <th className="px-2 py-1.5 text-right font-medium" title="What 1 Gold costs in this currency (best offer)">Buy 1G</th>
          <th className="px-2 py-1.5 text-right font-medium" title="What you get for 1 Gold in this currency (best offer)">Sell 1G</th>
          <th className="px-2 py-1.5 text-right font-medium">24h</th>
          <th className="px-3 py-1.5 text-right font-medium">
            <span className="sr-only">Trend</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.currencyId} className={`border-b border-line/40 ${r.mid == null ? "text-dim" : ""}`}>
            <td className="px-3 py-1">
              <span className="flex items-center gap-1.5">
                <Flag country={countries.get(r.countryIds[0])} size={10} />
                <span className={r.mid == null ? "" : "text-fg"}>{r.currency}</span>
                {r.mid == null && (
                  <span
                    className="rounded bg-war/10 px-1 font-sans text-[9px] tracking-wide text-war uppercase"
                    title={`Buy and sell are far apart${r.spread ? ` (${r.spread.toFixed(1)}×)` : ""}: no trustworthy price, so this currency's markets aren't converted to Gold.`}
                  >
                    illiquid
                  </span>
                )}
              </span>
            </td>
            <td className="px-2 py-1 text-right tnum">{price(r.buy)}</td>
            <td className="px-2 py-1 text-right tnum text-muted">{price(r.sell)}</td>
            <td className="px-2 py-1 text-right">
              <Delta value={r.change24h} />
            </td>
            <td className="px-3 py-1 text-right">
              <Spark points={r.spark} width={48} height={14} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
