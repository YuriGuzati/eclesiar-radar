import { route } from "@/lib/http";
import { warDetail } from "@/lib/queries";

export const GET = route(async (req) => {
  const warId = Number(new URL(req.url).pathname.split("/").at(-1));
  if (!Number.isInteger(warId)) throw new Error("invalid war id");
  return warDetail(warId);
}, { maxAgeSec: 30 });
