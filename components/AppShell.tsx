"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStatus, useNow } from "@/lib/hooks";
import { ago, compact, int } from "@/lib/format";

const NAV = [
  { href: "/", label: "Market" },
  { href: "/arbitrage", label: "Arbitrage" },
  { href: "/wars", label: "Wars" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const status = useStatus();
  const now = useNow(15_000);
  const s = status.data;
  const live = status.isSuccess && !status.isError;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 sm:gap-4 sm:px-4">
        <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded bg-gold text-[13px] font-bold text-bg">E</span>
          <span className="hidden sm:inline">
            ECLESIAR <span className="text-gold">RADAR</span>
          </span>
        </Link>

        <nav className="flex items-center sm:gap-1" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`rounded px-2 py-1 text-sm transition-colors sm:px-2.5 ${active ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 font-mono text-xs text-muted sm:gap-3">
          {s?.mode === "demo" && (
            <span
              title="No ECLESIAR_API_KEY: prices, wars and events are synthetic. See the README to connect the real API."
              className="rounded border border-gold/40 bg-gold-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-gold"
            >
              DEMO
            </span>
          )}
          {s?.server && (
            <span className="hidden md:inline">
              Day <span className="text-fg">{s.server.day ?? "—"}</span> · <span className="text-fg">{s.server.time ?? "—"}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5" title={live ? "Connected" : status.isError ? "Couldn't reach the server" : "Connecting"}>
            <span className={`h-2 w-2 rounded-full ${live ? "live-dot bg-up" : status.isError ? "bg-down" : "bg-gold"}`} />
            <span className="hidden sm:inline">{live ? "LIVE" : status.isError ? "ERROR" : "…"}</span>
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-dim sm:px-4">
        {s ? (
          <>
            <span>
              collector: {s.lastRun ? ago(s.lastRun.finishedAt ?? s.lastRun.startedAt, now) : "waiting for first run"}
              {s.autoIngestMinutes > 0 ? ` · every ${s.autoIngestMinutes} min` : " · external cron"}
            </span>
            <span>
              markets: {int(s.coverage.withOffers)} with offers / {int(s.coverage.markets)} read
            </span>
            {s.mode === "live" && (
              <span>
                API today: {compact(s.usageToday)} / {compact(s.dailyLimit)}
              </span>
            )}
            <span>db: {s.db}</span>
          </>
        ) : (
          <span>loading status…</span>
        )}
        <span className="ml-auto">Fan project · not affiliated with Eclesiar · data from the official public API</span>
      </footer>
    </div>
  );
}
