"use client";

import type { ReactNode } from "react";
import { pct } from "@/lib/format";
import type { CountryInfo } from "@/lib/types";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-line bg-panel ${className}`}>
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 className="min-w-0 truncate text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">{title}</h2>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** The country's flag from the game (API avatar URL), or an initials chip if there's none. */
export function Flag({ country, size = 16 }: { country?: Pick<CountryInfo, "name" | "avatar"> | null; size?: number }) {
  if (!country) return <span className="inline-block shrink-0 rounded-sm bg-line" style={{ width: size * 1.4, height: size }} />;
  if (country.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={country.avatar}
        alt=""
        width={size * 1.4}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="inline-block shrink-0 rounded-sm object-cover"
        style={{ width: size * 1.4, height: size }}
      />
    );
  }
  const initials = country.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-sm bg-panel-2 font-mono text-[9px] font-semibold text-muted ring-1 ring-line"
      style={{ width: size * 1.4, height: size }}
    >
      {initials}
    </span>
  );
}

export function CountryName({ country, size = 14 }: { country?: CountryInfo | null; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Flag country={country} size={size} />
      <span className="truncate">{country?.name ?? "—"}</span>
    </span>
  );
}

/** Signed % change with arrow; color is never the only signal. */
export function Delta({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={`text-dim ${className}`}>—</span>;
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  return (
    <span className={`tnum whitespace-nowrap ${flat ? "text-muted" : up ? "text-up" : "text-down"} ${className}`}>
      <span aria-hidden>{flat ? "■" : up ? "▲" : "▼"}</span> {pct(value)}
    </span>
  );
}

export function Spark({ points, width = 64, height = 18 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="inline-block" style={{ width, height }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 1 - ((p - min) / span) * (height - 2)).toFixed(1)}`).join("");
  const up = points.at(-1)! >= points[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-line p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-[3px] px-2 py-0.5 font-mono text-[11px] transition-colors ${
            o.value === value ? "bg-gold-soft text-gold" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-24 items-center justify-center p-4 text-center text-sm text-dim">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center p-4 text-center text-sm text-down">
      Failed to load: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-panel-2" style={{ width: `${90 - ((i * 13) % 35)}%` }} />
      ))}
    </div>
  );
}

/** Renders loading / error / empty states around a query result. */
export function QueryState<T>({
  q,
  empty,
  isEmpty,
  children,
  rows,
}: {
  q: { data: T | undefined; error: unknown; isPending: boolean };
  empty: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
  rows?: number;
}) {
  if (q.data === undefined) return q.error ? <ErrorBox error={q.error} /> : <Loading rows={rows} />;
  if (isEmpty?.(q.data)) return <Empty>{empty}</Empty>;
  return <>{children(q.data)}</>;
}
