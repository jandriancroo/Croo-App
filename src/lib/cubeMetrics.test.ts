import { describe, expect, it } from "vitest";
import {
  computePace,
  laborPct,
  resolveGoal,
  storeNow,
  weightedLaborPct,
} from "../../supabase/functions/_shared/cubeMetrics";
import { resolveProjection } from "@/hooks/useResolvedProjection";

describe("resolveGoal", () => {
  it("override > living > initial > projected, ignoring <= 0", () => {
    expect(resolveGoal({ override_projection: 900, living_projection: 800, initial_projection: 700, projected_sales: 600 })).toBe(900);
    expect(resolveGoal({ override_projection: 0, living_projection: 800, initial_projection: 700 })).toBe(800);
    expect(resolveGoal({ override_projection: -5, living_projection: null, initial_projection: 700 })).toBe(700);
    expect(resolveGoal({ projected_sales: "600" })).toBe(600);
    expect(resolveGoal({})).toBeNull();
    expect(resolveGoal(null)).toBeNull();
    expect(resolveProjection({ living_projection: 800, initial_projection: 700 })).toMatchObject({ value: 800, source: "living", isLiving: true });
  });
});

const hourly = [
  { hour: "11:00", sales: 120, projected: 100 },
  { hour: "12:00", sales: 240, projected: 200 },
  { hour: "13:00", sales: 180, projected: 150 },
  { hour: "14:00", sales: 0, projected: 120 },
  { hour: "17:00", sales: 0, projected: 300 },
];

describe("computePace", () => {
  const base = { hourly_data: hourly, net_sales: 540, nowInStoreTz: { hour: 14, minute: 10 }, nowMs: Date.parse("2026-10-09T21:10:00Z") };
  it("is deterministic (same input → same output)", () => {
    const a = computePace(base);
    const b = computePace(base);
    expect(a).toBe(b);
    // lunch +20% avg, boost 0.03*0.4=0.012 → factor 1.212; 540 + (120+300)*1.212
    expect(a).toBeCloseTo(540 + 420 * 1.212, 6);
  });
  it("uses stored pace only when fresh (< 15 min)", () => {
    const fresh = computePace({ ...base, pace_adjusted_projection: 2000, pace_calculated_at: "2026-10-09T21:00:00Z" });
    expect(fresh).toBe(2000);
    const stale = computePace({ ...base, pace_adjusted_projection: 2000, pace_calculated_at: "2026-10-09T20:40:00Z" });
    expect(stale).toBeCloseTo(540 + 420 * 1.212, 6);
    expect(computePace({ ...base, pace_adjusted_projection: 100, pace_calculated_at: "2026-10-09T21:05:00Z" })).toBe(540); // never below sales
  });
  it("returns null with no hourly data; no boost when behind", () => {
    expect(computePace({ ...base, hourly_data: [] })).toBeNull();
    expect(computePace({ ...base, hourly_data: null })).toBeNull();
    const behind = hourly.map((h) => ({ ...h, sales: h.sales ? h.projected * 0.8 : 0 }));
    expect(computePace({ ...base, hourly_data: behind, net_sales: 360 })).toBeCloseTo(360 + 420 * 0.8, 6);
  });
});

describe("storeNow", () => {
  it("uses the store's own time zone", () => {
    const at = new Date("2026-10-09T16:30:00Z");
    expect(storeNow("America/Chicago", at)).toEqual({ date: "2026-10-09", hour: 11, minute: 30 });
    expect(storeNow("America/Los_Angeles", at)).toEqual({ date: "2026-10-09", hour: 9, minute: 30 });
    expect(storeNow("America/Los_Angeles", new Date("2026-10-09T05:15:00Z"))).toEqual({ date: "2026-10-08", hour: 22, minute: 15 });
  });
});

describe("labor %", () => {
  it("weighted Σlabor/Σsales differs from the average of percents", () => {
    const rows = [{ labor: 300, sales: 1000 }, { labor: 100, sales: 200 }, { labor: 0, sales: 500 }, { labor: 50, sales: 0 }];
    expect(weightedLaborPct(rows)).toBeCloseTo((400 / 1200) * 100, 6);
    const unweighted = (laborPct(300, 1000)! + laborPct(100, 200)!) / 2;
    expect(unweighted).toBeCloseTo(40, 6);
    expect(weightedLaborPct(rows)).not.toBeCloseTo(unweighted, 2);
    expect(weightedLaborPct([])).toBeNull();
    expect(laborPct(0, 100)).toBeNull();
    expect(laborPct(25, 100)).toBe(25);
  });
});
