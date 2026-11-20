import { route } from "@/lib/http";
import { fx } from "@/lib/queries";

export const GET = route(() => fx(), { maxAgeSec: 30 });
