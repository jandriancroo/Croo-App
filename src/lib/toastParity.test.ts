import { describe, expect, it } from "vitest";
import { formatHourlyTo24 } from "../../supabase/functions/_shared/hourly";
import { pizzaCountFromMix } from "../../supabase/functions/_shared/productMix";
import { normToastName } from "../../supabase/functions/_shared/toastNames";
import { repostDates } from "../../supabase/functions/_shared/toastRepost";
import { lateMinutes, localMinutesOfDay, openShiftEndMs, regularHours } from "../../supabase/functions/_shared/toastLabor";

describe("formatHourlyTo24", () => {
  it("pads to 24 hours and keeps projected/labor keys", () => {
    const out = formatHourlyTo24([{ hour: "11:00", sales: 120, checksCount: 4 }], [
      { hour: "11:00", projected: 150, laborPercent: 22, laborCost: 30 },
      { hour: "12:00", projected: 0 },
    ]);
    expect(out).toHaveLength(24);
    expect(out[0]).toEqual({ hour: "00:00", sales: 0, checksCount: 0 });
    expect(out[11]).toEqual({ hour: "11:00", sales: 120, checksCount: 4, projected: 150, laborPercent: 22, laborCost: 30 });
    expect(out[12].projected).toBeUndefined();
  });
});

describe("pizzaCountFromMix", () => {
  it("counts pizzas, halves as 0.5, ignores the rest", () => {
    expect(pizzaCountFromMix([
      { itemName: "Pepperoni", category: "Pizza", quantity: 3 },
      { itemName: "1/2 Cheese Pizza", category: "Kids", quantity: 2 },
      { itemName: "Half Veggie", category: "Pizzas", quantity: 1 },
      { itemName: "Garlic Knots", category: "Sides", quantity: 9 },
      { itemName: "Soda", category: "", quantity: 4 },
    ])).toBe(5); // 3 + 1 + 0.5 = 4.5 → 5
    expect(pizzaCountFromMix([])).toBe(0);
  });
});

describe("normToastName", () => {
  it("strips accents, spaces and punctuation", () => {
    expect(normToastName("José  Núñez-O'Brien")).toBe("josenunezobrien");
    expect(normToastName(" Sam  B. ")).toBe("samb");
    expect(normToastName(null)).toBe("");
  });
});

describe("repostDates", () => {
  const base = { businessDate: "2026-10-09", sales: [], toastLaborDates: [], openShiftDates: [], rawSources: [], yesterdayEndAt: "2026-10-09T08:00:00Z" };
  it("re-posts yesterday when it was never read after close", () => {
    expect(repostDates({ ...base, sales: [{ sale_date: "2026-10-08", net_sales: 0, fetched_at: "2026-10-09T04:00:00Z" }] })).toEqual(["2026-10-08"]);
    expect(repostDates({ ...base, sales: [{ sale_date: "2026-10-08", net_sales: 0, fetched_at: "2026-10-09T09:00:00Z" }] })).toEqual([]);
  });
  it("re-posts yesterday when only the live robot wrote it", () => {
    expect(repostDates({ ...base, rawSources: [{ sale_date: "2026-10-08", data_source: "live" }] })).toEqual(["2026-10-08"]);
    expect(repostDates({ ...base, rawSources: [{ sale_date: "2026-10-08", data_source: "export" }] })).toEqual([]);
  });
  it("re-posts sales days with no Toast labor", () => {
    expect(repostDates({ ...base, sales: [{ sale_date: "2026-10-03", net_sales: 900, fetched_at: "2026-10-04T10:00:00Z" }] })).toEqual(["2026-10-03"]);
    expect(repostDates({ ...base, toastLaborDates: ["2026-10-03"], sales: [{ sale_date: "2026-10-03", net_sales: 900, fetched_at: "2026-10-04T10:00:00Z" }] })).toEqual([]);
  });
  it("re-posts days with an open shift", () => {
    expect(repostDates({ ...base, openShiftDates: ["2026-10-05", "2026-10-09"] })).toEqual(["2026-10-05"]);
  });
  it("keeps the 21-day window and the max-10 cap, oldest first", () => {
    const sales = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 8 - i)).toISOString().slice(0, 10);
      return { sale_date: d, net_sales: 100, fetched_at: "2026-10-09T09:00:00Z" };
    });
    const out = repostDates({ ...base, sales });
    expect(out).toHaveLength(10);
    expect(out[0]).toBe("2026-09-18");
    expect(out.every((d) => d >= "2026-09-18" && d < "2026-10-09")).toBe(true);
  });
});

describe("late check uses minutes", () => {
  const tz = "America/Chicago";
  it("counts real clock-in minutes", () => {
    expect(localMinutesOfDay("2026-10-09T16:20:00Z", tz)).toBe(11 * 60 + 20);
    expect(lateMinutes("2026-10-09T16:20:00Z", "11:00:00", tz)).toBe(20); // old check said 0
    expect(lateMinutes("2026-10-09T16:05:00Z", "11:00", tz)).toBeNull(); // 5 min = not late
    expect(lateMinutes("2026-10-09T16:06:00Z", "11:00", tz)).toBe(6);
    expect(lateMinutes("2026-10-09T15:50:00Z", "11:00", tz)).toBeNull();
  });
  it("caps open shifts on past dates at the business-day end", () => {
    const now = Date.parse("2026-10-09T19:00:00Z");
    expect(openShiftEndMs(true, "2026-10-08T08:00:00Z", now)).toBe(now);
    expect(openShiftEndMs(false, "2026-10-08T08:00:00Z", now)).toBe(Date.parse("2026-10-08T08:00:00Z"));
    expect(openShiftEndMs(false, null, now)).toBe(now);
  });
});

describe("regular hours", () => {
  it("is total minus overtime minus double time, never negative", () => {
    expect(regularHours(42.5, 2.5, 0)).toBe(40);
    expect(regularHours(12, 2, 2)).toBe(8);
    expect(regularHours(1, 2, 0)).toBe(0);
  });
});
