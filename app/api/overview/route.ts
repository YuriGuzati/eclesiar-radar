import { route } from "@/lib/http";
import { overview } from "@/lib/queries";

export const GET = route(() => overview(), { maxAgeSec: 20 });
