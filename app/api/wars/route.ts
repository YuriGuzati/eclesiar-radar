import { route } from "@/lib/http";
import { wars } from "@/lib/queries";

export const GET = route(() => wars(), { maxAgeSec: 30 });
