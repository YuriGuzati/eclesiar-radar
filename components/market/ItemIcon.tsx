"use client";

import { category } from "@/lib/format";
import type { ItemInfo } from "@/lib/types";

const GLYPH: Record<string, string> = { Food: "🍞", Weapons: "🔫", Aircraft: "✈", Tickets: "🎫", "Raw materials": "⛏" };

/** The game's own item picture (from the API), or a category glyph if an item has none. */
export function ItemIcon({ item, size = 18 }: { item: Pick<ItemInfo, "avatar" | "type">; size?: number }) {
  if (item.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.avatar} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="inline-grid shrink-0 place-items-center rounded bg-panel-2 text-[11px] ring-1 ring-line" style={{ width: size, height: size }}>
      {GLYPH[category(item.type)] ?? "•"}
    </span>
  );
}
