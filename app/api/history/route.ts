import { intParam, route } from "@/lib/http";
import { history } from "@/lib/queries";
import type { Timeframe } from "@/lib/types";

const TFS: Timeframe[] = ["15m", "1h", "4h", "1d"];

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const itemId = intParam(url, "item");
  if (itemId == null) throw new Error("missing ?item");
  const tf = (TFS as string[]).includes(url.searchParams.get("tf") ?? "") ? (url.searchParams.get("tf") as Timeframe) : "1h";
  const unit = url.searchParams.get("unit") === "local" ? "local" : "gold";
  return history(itemId, intParam(url, "country"), tf, unit);
}, { maxAgeSec: 30 });
