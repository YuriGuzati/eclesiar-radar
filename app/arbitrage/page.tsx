import type { Metadata } from "next";
import { ArbitrageView } from "@/components/arbitrage/ArbitrageView";

export const metadata: Metadata = { title: "Arbitrage" };

export default function ArbitragePage() {
  return <ArbitrageView />;
}
