import { route } from "@/lib/http";
import { nukes } from "@/lib/queries";

export const GET = route(() => nukes(), { maxAgeSec: 5 });
