import { describe, it, expect } from "vitest";
import { isOnSchedule } from "../../supabase/functions/_shared/availabilityInsights";

const P = { is_active: true, appears_on_schedule: true };
describe("isOnSchedule", () => {
  it("show_on_schedule false → excluded", () => expect(isOnSchedule(P, { show_on_schedule: false })).toBe(false));
  it("show_on_schedule null/true → included", () => {
    expect(isOnSchedule(P, { show_on_schedule: null })).toBe(true);
    expect(isOnSchedule(P, { show_on_schedule: true })).toBe(true);
  });
  it("is_active false → excluded", () => expect(isOnSchedule({ ...P, is_active: false }, { show_on_schedule: true })).toBe(false));
  it("appears_on_schedule false → excluded", () => expect(isOnSchedule({ ...P, appears_on_schedule: false }, {})).toBe(false));
  it("no store link → excluded", () => expect(isOnSchedule(P, undefined)).toBe(false));
});
