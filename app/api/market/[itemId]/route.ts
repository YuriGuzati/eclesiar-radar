import { intParam, route } from "@/lib/http";
import { itemMarkets } from "@/lib/queries";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const itemId = Number(url.pathname.split("/").at(-1));
  if (!Number.isInteger(itemId)) throw new Error("invalid item id");
  return itemMarkets(itemId, intParam(url, "country"));
}, { maxAgeSec: 20 });
