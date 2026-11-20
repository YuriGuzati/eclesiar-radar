import { route } from "@/lib/http";
import { status } from "@/lib/queries";

export const GET = route(() => status());
