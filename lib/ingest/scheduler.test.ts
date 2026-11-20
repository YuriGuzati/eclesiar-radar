import { describe, expect, it } from "vitest";
import { buildSpecs, effectiveInterval, pickTasks, type TaskSpec, type TaskState } from "./scheduler";

const spec = (key: string, priority: number, intervalSec = 600, weight = 1, cost = 1): TaskSpec => ({ key, kind: "market", cost, intervalSec, priority, weight });

describe("pickTasks", () => {
  const now = 100_000;

  it("runs never-seen tasks first, by priority class, within budget", () => {
    const specs = [spec("m1", 2), spec("ref", 0), spec("fx", 1, 600, 1, 2), spec("m2", 2)];
    const picked = pickTasks(specs, new Map(), now, 3).map((s) => s.key);
    expect(picked).toEqual(["ref", "fx"]); // 1 + 2 = budget; markets wait
  });

  it("skips tasks that aren't due and prefers the most overdue × weight", () => {
    const states = new Map<string, TaskState>([
      ["fresh", { lastRun: now - 100, emptyStreak: 0, failStreak: 0 }],
      ["late", { lastRun: now - 1200, emptyStreak: 0, failStreak: 0 }],
      ["later", { lastRun: now - 6000, emptyStreak: 0, failStreak: 0 }],
    ]);
    const picked = pickTasks([spec("fresh", 2), spec("late", 2), spec("later", 2)], states, now, 10).map((s) => s.key);
    expect(picked).toEqual(["later", "late"]);
  });

  it("lets cheaper tasks fill leftover budget", () => {
    const picked = pickTasks([spec("big", 1, 600, 1, 5), spec("small", 2)], new Map(), now, 2).map((s) => s.key);
    expect(picked).toEqual(["small"]);
  });

  it("backs off empty and failing markets", () => {
    const s = spec("x", 2, 600);
    expect(effectiveInterval(s, { lastRun: 0, emptyStreak: 0, failStreak: 0 })).toBe(600);
    expect(effectiveInterval(s, { lastRun: 0, emptyStreak: 2, failStreak: 0 })).toBe(2400);
    expect(effectiveInterval(s, { lastRun: 0, emptyStreak: 10, failStreak: 0 })).toBe(4800); // capped at 8x
    expect(effectiveInterval(s, { lastRun: 0, emptyStreak: 0, failStreak: 5 })).toBe(2400); // capped at 4x
  });
});

describe("buildSpecs", () => {
  it("creates one fx task per currency (never Gold) and one market task per pair", () => {
    const specs = buildSpecs(
      [
        { id: 1, currencyId: 10, rank: 0 },
        { id: 2, currencyId: 10, rank: 1 }, // shared currency
        { id: 3, currencyId: 1, rank: 2 }, // Gold: not quotable
      ],
      [100, 200],
    );
    expect(specs.filter((s) => s.kind === "fx").map((s) => s.key)).toEqual(["fx:10"]);
    expect(specs.filter((s) => s.kind === "market")).toHaveLength(6);
    expect(specs.filter((s) => s.priority === 0)).toHaveLength(3);
  });

  it("refreshes popular countries more often", () => {
    const specs = buildSpecs([{ id: 1, currencyId: 10, rank: 0 }, { id: 2, currencyId: 11, rank: 40 }], [1]);
    const m1 = specs.find((s) => s.key === "mkt:1:1")!;
    const m2 = specs.find((s) => s.key === "mkt:2:1")!;
    expect(m1.intervalSec).toBeLessThan(m2.intervalSec);
    expect(m1.weight).toBeGreaterThan(m2.weight);
  });
});
