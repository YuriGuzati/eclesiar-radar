import type { Metadata } from "next";
import { WarsView } from "@/components/war/WarsView";

export const metadata: Metadata = { title: "Wars" };

export default function WarsPage() {
  return <WarsView />;
}
