import { route } from "@/lib/http";
import { events } from "@/lib/queries";

export const GET = route(() => events(), { maxAgeSec: 30 });
