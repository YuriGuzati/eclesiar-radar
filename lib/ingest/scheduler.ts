/**
 * Budget-aware task picker for the collector.
 *
 * The API allows 50,000 requests/day per account and every (country, item)
 * order book is a separate request, so we can't refresh everything every few
 * minutes. Each task declares how often it *wants* to run; each collector run
 * gets a request budget and spends it on the most overdue tasks, reference data
 * first, then currency rates (needed to convert prices), then markets.
 * Markets that keep coming back empty, or keep failing, back off exponentially.
 */

export type TaskKind = "countries" | "items" | "stats" | "regions" | "fx" | "market";

export interface TaskSpec {
  key: string;
  kind: TaskKind;
  /** Upstream requests the task costs. */
  cost: number;
  intervalSec: number;
  /** Lower runs first. */
  priority: number;
  /** Relative importance inside a priority class. */
  weight: number;
  countryId?: number;
  itemId?: number;
  currencyId?: number;
}

export interface TaskState {
  lastRun: number; // unix seconds
  emptyStreak: number;
  failStreak: number;
}

export function effectiveInterval(spec: TaskSpec, state?: TaskState): number {
  if (!state) return spec.intervalSec;
  const emptyMul = Math.min(8, 2 ** state.emptyStreak);
  const failMul = Math.min(4, 2 ** state.failStreak);
  return spec.intervalSec * Math.max(emptyMul, failMul);
}

export function pickTasks(
  specs: TaskSpec[],
  states: Map<string, TaskState>,
  now: number,
  budget: number,
): TaskSpec[] {
  const scored: { spec: TaskSpec; score: number }[] = [];
  for (const spec of specs) {
    const st = states.get(spec.key);
    if (!st) {
      scored.push({ spec, score: 1e6 });
      continue;
    }
    const overdue = (now - st.lastRun) / effectiveInterval(spec, st);
    if (overdue >= 1) scored.push({ spec, score: overdue });
  }
  scored.sort((a, b) => a.spec.priority - b.spec.priority || b.score * b.spec.weight - a.score * a.spec.weight);

  const out: TaskSpec[] = [];
  let left = budget;
  for (const { spec } of scored) {
    if (spec.cost > left) continue;
    out.push(spec);
    left -= spec.cost;
    if (left <= 0) break;
  }
  return out;
}

/**
 * Refresh cadence by country popularity rank (0 = most active citizens).
 * At ~70 countries × ~25 items this lands around 20–25k requests/day,
 * comfortably under the quota, before empty-market backoff kicks in.
 */
export function marketInterval(rank: number): number {
  if (rank < 10) return 30 * 60;
  if (rank < 25) return 90 * 60;
  return 6 * 3600;
}

export function fxInterval(rank: number): number {
  return rank < 25 ? 60 * 60 : 3 * 3600;
}

export const rankWeight = (rank: number) => 1 / (1 + rank / 10);

export interface RefCountry {
  id: number;
  currencyId: number | null;
  rank: number;
}

export function buildSpecs(countries: RefCountry[], itemIds: number[]): TaskSpec[] {
  const specs: TaskSpec[] = [
    { key: "ref:countries", kind: "countries", cost: 1, intervalSec: 6 * 3600, priority: 0, weight: 1 },
    { key: "ref:items", kind: "items", cost: 2, intervalSec: 24 * 3600, priority: 0, weight: 1 },
    { key: "ref:stats", kind: "stats", cost: 1, intervalSec: 6 * 3600, priority: 0, weight: 1 },
  ];
  const seenCurrency = new Set<number>();
  for (const c of countries) {
    const w = rankWeight(c.rank);
    if (c.currencyId != null && c.currencyId !== 1 && !seenCurrency.has(c.currencyId)) {
      seenCurrency.add(c.currencyId);
      specs.push({ key: `fx:${c.currencyId}`, kind: "fx", cost: 2, intervalSec: fxInterval(c.rank), priority: 1, weight: w, currencyId: c.currencyId, countryId: c.id });
    }
    for (const itemId of itemIds) {
      specs.push({ key: `mkt:${c.id}:${itemId}`, kind: "market", cost: 1, intervalSec: marketInterval(c.rank), priority: 2, weight: w, countryId: c.id, itemId });
    }
    specs.push({ key: `reg:${c.id}`, kind: "regions", cost: 1, intervalSec: 24 * 3600, priority: 3, weight: w, countryId: c.id });
  }
  return specs;
}
