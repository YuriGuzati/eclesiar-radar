"use client";

import { useMemo, useState } from "react";
import { useArbitrage, useCountries, useNow } from "@/lib/hooks";
import { ago, category, categoryRank, compact, int, itemLabel, pct, price } from "@/lib/format";
import { CountryName, Panel, QueryState, Segmented } from "@/components/ui";
import { ItemIcon } from "@/components/market/ItemIcon";

const G = () => <span className="ml-0.5 text-[0.85em] text-gold">G</span>;

export function ArbitrageView() {
  const countries = useCountries();
  const [home, setHome] = useState<number | null>(null);
  const [minUnits, setMinUnits] = useState(1);
  const [type, setType] = useState("ALL");
  const [onlyProfit, setOnlyProfit] = useState(true);
  const [minActive, setMinActive] = useState(20);
  const q = useArbitrage(home, minUnits, minActive);
  const now = useNow(30_000);

  const types = useMemo(
    () => [...new Set((q.data ?? []).map((r) => category(r.item.type)))].sort((a, b) => categoryRank(a) - categoryRank(b)),
    [q.data],
  );
  const rows = (q.data ?? []).filter((r) => (type === "ALL" || category(r.item.type) === type) && (!onlyProfit || r.netPct > 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Your citizenship</span>
          <select
            value={home ?? ""}
            onChange={(e) => setHome(e.target.value === "" ? null : Number(e.target.value))}
            className="rounded border border-line bg-bg px-1.5 py-0.5 text-sm"
          >
            <option value="">Ignore</option>
            {[...countries.values()].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted">Min. units at best offer</span>
          <Segmented
            label="Minimum units"
            value={minUnits}
            onChange={setMinUnits}
            options={[1, 10, 100, 1000].map((v) => ({ value: v, label: compact(v) }))}
          />
        </label>
        <label className="flex items-center gap-2" title="Small markets have pricey listings but hardly anyone buying">
          <span className="text-muted">Destination with ≥</span>
          <Segmented
            label="Minimum active citizens at the destination"
            value={minActive}
            onChange={setMinActive}
            options={[0, 20, 50].map((v) => ({ value: v, label: String(v) }))}
          />
          <span className="text-muted">active</span>
        </label>
        <Segmented
          label="Item type"
          value={type}
          onChange={setType}
          options={[{ value: "ALL", label: "All" }, ...types.map((t) => ({ value: t, label: t }))]}
        />
        <label className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={onlyProfit} onChange={(e) => setOnlyProfit(e.target.checked)} className="accent-[var(--color-gold)]" />
          Profitable only
        </label>
      </div>

      <Panel title="Cross-market opportunities (estimate)" bodyClass="scroll-thin overflow-auto" className="flex-1">
        <QueryState q={q} isEmpty={() => rows.length === 0} empty="No opportunities with these filters right now.">
          {() => (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-panel text-[10px] tracking-wider text-dim uppercase">
                <tr className="border-b border-line">
                  <th className="px-3 py-1.5 text-left font-medium">Item</th>
                  <th className="px-2 py-1.5 text-left font-medium">Buy in</th>
                  <th className="px-2 py-1.5 text-right font-medium">Price</th>
                  <th className="px-2 py-1.5 text-left font-medium">Sell in</th>
                  <th className="px-2 py-1.5 text-right font-medium">Best offer there</th>
                  <th className="px-2 py-1.5 text-right font-medium">Tax</th>
                  <th className="px-2 py-1.5 text-right font-medium">Net</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium">Est. profit</th>
                  <th className="hidden px-3 py-1.5 text-right font-medium lg:table-cell">Data</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {rows.map((r) => (
                  <tr key={r.item.id} className="border-b border-line/60 hover:bg-panel-2">
                    <td className="px-3 py-1.5 font-sans text-sm">
                      <span className="flex items-center gap-2">
                        <ItemIcon item={r.item} size={16} />
                        {itemLabel(r.item)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-sans text-sm">
                      <CountryName country={countries.get(r.buyCountryId)} />
                    </td>
                    <td className="px-2 py-1.5 text-right tnum">
                      {price(r.buyGold)}
                      <G />
                    </td>
                    <td className="px-2 py-1.5 font-sans text-sm">
                      <CountryName country={countries.get(r.sellCountryId)} />
                    </td>
                    <td className="px-2 py-1.5 text-right tnum">
                      {price(r.sellGold)}
                      <G />
                      <span className="ml-1 text-dim">(+{pct(r.grossPct, false)})</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tnum text-war">{r.taxPct ? `${pct(r.taxPct, false)}` : "0%"}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold tnum ${r.netPct > 0 ? "text-up" : "text-down"}`}>{pct(r.netPct)}</td>
                    <td className="px-2 py-1.5 text-right tnum">{int(r.buyUnits)}</td>
                    <td className={`px-2 py-1.5 text-right tnum ${r.profitGold > 0 ? "text-up" : "text-muted"}`}>
                      {price(r.profitGold)}
                      <G />
                    </td>
                    <td className="hidden px-3 py-1.5 text-right text-dim lg:table-cell">
                      {now ? ago(now - Math.max(r.buyAge, r.sellAge), now) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </Panel>

      <p className="px-1 text-xs leading-relaxed text-dim">
        How it&apos;s calculated: buy the best offer in the cheapest country (converted to Gold at the exchange rate) and list 1% below the
        destination&apos;s best offer. The destination charges its import tax on foreign sellers; if the destination is your citizenship, there&apos;s
        no tax. Destination listings above 2× the item&apos;s median are ignored (“parked” prices nobody buys), as are countries whose currency has
        no trustworthy exchange rate and, by default, destinations with fewer than 20 active citizens. <strong className="text-muted">It doesn&apos;t account for</strong>{" "}
        VAT, travel, exchange spread or how fast items sell — check in-game before trading.
      </p>
    </div>
  );
}
