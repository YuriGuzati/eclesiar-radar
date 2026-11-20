"use client";

import { useState } from "react";
import { useCountries, useEvents, useNow, useNukes, useWarDetail, useWars } from "@/lib/hooks";
import { clock, compact, countdown, dateTime, int } from "@/lib/format";
import type { HeroDto, RoundDto, WarDto } from "@/lib/types";
import { Empty, Flag, Panel, QueryState } from "@/components/ui";

const ATT = "text-war";
const DEF = "text-sky-400";

export function WarsView() {
  const wars = useWars();
  const now = useNow(1000);
  const [picked, setPicked] = useState<number | null>(null);
  const selectedId = picked ?? wars.data?.[0]?.id ?? null;
  const selected = wars.data?.find((w) => w.id === selectedId) ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-[340px_minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
      <Panel title={`Active wars${wars.data ? ` · ${wars.data.length}` : ""}`} bodyClass="scroll-thin overflow-y-auto" className="max-h-[460px] lg:max-h-none">
        <QueryState q={wars} isEmpty={(d) => d.length === 0} empty="No active wars right now.">
          {(list) => (
            <ul>
              {list.map((w) => (
                <li key={w.id}>
                  <WarCard war={w} now={now} active={w.id === selectedId} onClick={() => setPicked(w.id)} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Panel>

      {selected ? (
        <WarDetailPanel war={selected} now={now} />
      ) : (
        <Panel title="Details">
          <Empty>Select a war.</Empty>
        </Panel>
      )}

      <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto] gap-2 lg:grid-rows-[auto_minmax(0,1fr)]">
        <NukesPanel now={now} />
        <EventsPanel />
      </div>
    </div>
  );
}

function WarCard({ war, now, active, onClick }: { war: WarDto; now: number | null; active: boolean; onClick: () => void }) {
  const r = war.current;
  const left = r?.endsAt != null && now != null ? r.endsAt - now : null;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`w-full border-b border-l-2 border-b-line/60 px-3 py-2.5 text-left transition-colors ${active ? "border-l-war bg-panel-2" : "border-l-transparent hover:bg-panel-2/60"}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <Flag country={war.attackers} size={13} />
          <span className="truncate">{war.attackers.name}</span>
        </span>
        <span className="font-mono text-base font-semibold tnum" title="Rounds won">
          <span className={war.attackersScore > war.defendersScore ? ATT : ""}>{war.attackersScore}</span>
          <span className="px-1 text-dim">×</span>
          <span className={war.defendersScore > war.attackersScore ? DEF : ""}>{war.defendersScore}</span>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          <span className="truncate">{war.defenders.name}</span>
          <Flag country={war.defenders} size={13} />
        </span>
      </div>
      {r && <PointsBar round={r} thin />}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="truncate">📍 {war.region ?? "—"}</span>
        <span className="flex shrink-0 items-center gap-2 font-mono">
          {war.revolution && <span className="rounded bg-war/15 px-1 text-[10px] text-war">REVOLUTION</span>}
          {war.civilWar && <span className="rounded bg-war/15 px-1 text-[10px] text-war">CIVIL WAR</span>}
          R{war.round ?? "—"}
          {left != null && left > 0 && <span className="text-fg">· {countdown(left)}</span>}
        </span>
      </div>
    </button>
  );
}

/** Points decide the round; the bar shows each side's share. */
function PointsBar({ round, thin = false }: { round: RoundDto; thin?: boolean }) {
  const total = round.attackersPoints + round.defendersPoints;
  const a = total > 0 ? (round.attackersPoints / total) * 100 : 50;
  return (
    <div className={`${thin ? "mt-1.5 h-1" : "h-2.5"} flex overflow-hidden rounded-full bg-panel-2`} role="img" aria-label={`Points: attackers ${round.attackersPoints}, defenders ${round.defendersPoints}`}>
      {total > 0 && (
        <>
          <div className="bg-war" style={{ width: `${a}%` }} />
          <div className="bg-sky-400" style={{ width: `${100 - a}%` }} />
        </>
      )}
    </div>
  );
}

function WarDetailPanel({ war, now }: { war: WarDto; now: number | null }) {
  const q = useWarDetail(war.id);
  const r = war.current;
  const left = r?.endsAt != null && now != null ? r.endsAt - now : null;
  return (
    <Panel
      title={
        <span className="normal-case tracking-normal">
          <span className="text-sm font-semibold text-fg">
            {war.attackers.name} × {war.defenders.name}
          </span>
          <span className="ml-2 text-muted">{war.region}</span>
        </span>
      }
      bodyClass="scroll-thin overflow-y-auto"
    >
      <div className="space-y-5 p-3">
        {r && (
          <section aria-label="Current round">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Round {war.round} · live</h3>
              <span className="font-mono text-xs text-muted">
                ends {clock(r.endsAt)}
                {left != null && left > 0 && <span className="ml-1 text-fg">({countdown(left)})</span>}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Points" att={r.attackersPoints} def={r.defendersPoints} format={int} />
              <Stat label="Damage" att={r.attackersDamage} def={r.defendersDamage} format={compact} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Hero hero={r.attackersHero} side={war.attackers.name} color={ATT} />
              <Hero hero={r.defendersHero} side={war.defenders.name} color={DEF} />
            </div>
          </section>
        )}

        <section aria-label="Rounds">
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Rounds</h3>
          <QueryState q={q} isEmpty={(d) => d.rounds.length === 0} empty="No rounds recorded." rows={4}>
            {(d) => (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead className="text-[10px] tracking-wider text-dim uppercase">
                    <tr className="border-b border-line">
                      <th className="py-1 pr-2 text-left font-medium">#</th>
                      <th className="py-1 pr-2 text-left font-medium">Ends</th>
                      <th className="py-1 pr-2 text-right font-medium">Points</th>
                      <th className="py-1 pr-2 text-right font-medium">Damage</th>
                      <th className="hidden py-1 pr-2 text-left font-medium md:table-cell">Heroes</th>
                      <th className="py-1 text-right font-medium">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rounds.map((rd) => (
                      <tr key={rd.id} className={`border-b border-line/40 ${rd.status === "scheduled" ? "text-dim" : ""}`}>
                        <td className="py-1 pr-2 text-dim">{rd.number}</td>
                        <td className="py-1 pr-2 whitespace-nowrap text-muted">{dateTime(rd.endsAt)}</td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap tnum">
                          {rd.status === "scheduled" ? "—" : (
                            <>
                              <span className={ATT}>{int(rd.attackersPoints)}</span> <span className="text-dim">/</span> <span className={DEF}>{int(rd.defendersPoints)}</span>
                            </>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap tnum">
                          {rd.status === "scheduled" ? "—" : (
                            <>
                              <span className={ATT}>{compact(rd.attackersDamage)}</span> <span className="text-dim">/</span> <span className={DEF}>{compact(rd.defendersDamage)}</span>
                            </>
                          )}
                        </td>
                        <td className="hidden max-w-48 truncate py-1 pr-2 font-sans md:table-cell">
                          {rd.attackersHero || rd.defendersHero ? (
                            <>
                              <span className={ATT}>{rd.attackersHero?.name ?? "—"}</span> <span className="text-dim">/</span> <span className={DEF}>{rd.defendersHero?.name ?? "—"}</span>
                            </>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                        <td className="py-1 text-right font-sans whitespace-nowrap">
                          {rd.status === "live" ? (
                            <span className="text-gold">in progress</span>
                          ) : rd.status === "scheduled" ? (
                            "scheduled"
                          ) : rd.winner === "att" ? (
                            <span className={ATT}>{war.attackers.name}</span>
                          ) : rd.winner === "def" ? (
                            <span className={DEF}>{war.defenders.name}</span>
                          ) : (
                            "draw"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </section>
      </div>
    </Panel>
  );
}

function Stat({ label, att, def, format }: { label: string; att: number; def: number; format: (n: number) => string }) {
  const total = att + def;
  const a = total > 0 ? (att / total) * 100 : 50;
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-xs">
        <span className={ATT}>{format(att)}</span>
        <span className="font-sans text-[10px] tracking-wider text-dim uppercase">{label}</span>
        <span className={DEF}>{format(def)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-panel-2" role="img" aria-label={`${label}: attackers ${a.toFixed(0)}%, defenders ${(100 - a).toFixed(0)}%`}>
        {total > 0 && (
          <>
            <div className="bg-war" style={{ width: `${a}%` }} />
            <div className="bg-sky-400" style={{ width: `${100 - a}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

function Hero({ hero, side, color }: { hero: HeroDto | null; side: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded border border-line bg-panel-2/50 px-2 py-1.5">
      {hero?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hero.avatar} alt="" width={24} height={24} loading="lazy" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line text-[10px]">★</span>
      )}
      <div className="min-w-0 text-xs">
        <div className="text-[10px] tracking-wider text-dim uppercase">
          Hero · <span className={color}>{side}</span>
        </div>
        <div className="truncate">
          {hero ? (
            <>
              {hero.name ?? `#${hero.id}`} <span className="font-mono text-muted">{compact(hero.damage)}</span>
            </>
          ) : (
            <span className="text-dim">nobody yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

function NukesPanel({ now }: { now: number | null }) {
  const q = useNukes();
  const countries = useCountries();
  return (
    <Panel title={<span className="flex items-center gap-1.5">☢ Nuclear strikes in flight</span>}>
      <QueryState q={q} isEmpty={(d) => d.nukes.length === 0} empty="No strikes in flight right now." rows={2}>
        {(d) => (
          <ul className="divide-y divide-line/60">
            {d.nukes.map((n) => {
              // impact_at is absolute Unix time, so the viewer's (NTP-synced) clock is enough.
              const total = n.impactAt - n.launchedAt || 1;
              const left = now != null ? n.impactAt - now : null;
              const progress = left != null ? Math.min(100, Math.max(0, ((total - left) / total) * 100)) : 0;
              return (
                <li key={n.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Flag country={n.fromCountryId != null ? countries.get(n.fromCountryId) : null} size={12} />
                      <span className="truncate">{n.fromCountry ?? "?"}</span>
                      <span className="text-dim">→</span>
                      <span className="truncate">
                        {n.toRegion ?? "?"}
                        {n.toCountry && <span className="text-muted"> ({n.toCountry})</span>}
                      </span>
                    </span>
                    <span className={`shrink-0 font-mono tnum ${left != null && left < 120 ? "text-down" : "text-war"}`}>
                      {left == null ? "—" : left > 0 ? countdown(left) : "impact"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full bg-war transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

function EventsPanel() {
  const q = useEvents();
  return (
    <Panel title="World events" bodyClass="scroll-thin overflow-y-auto" className="max-h-[460px] lg:max-h-none">
      <QueryState q={q} isEmpty={(d) => d.length === 0} empty="No recent events.">
        {(list) => (
          <ul className="divide-y divide-line/60">
            {list.map((e, k) => (
              <li key={k} className="px-3 py-2">
                <p className="text-sm leading-snug">{e.title || e.text}</p>
                {e.text && e.text !== e.title && <p className="mt-0.5 text-xs text-muted">{e.text}</p>}
                <p className="mt-0.5 font-mono text-[10px] text-dim">{dateTime(e.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}
