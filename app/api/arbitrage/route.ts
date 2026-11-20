import { intParam, route } from "@/lib/http";
import { arbitrage } from "@/lib/queries";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  return arbitrage(intParam(url, "home"), Math.max(1, intParam(url, "minUnits") ?? 1), Math.max(0, intParam(url, "minActive") ?? 0));
}, { maxAgeSec: 30 });
