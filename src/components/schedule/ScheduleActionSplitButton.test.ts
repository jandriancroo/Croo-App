import { describe, it, expect } from "vitest";
import { pickDefaultAction } from "./ScheduleActionSplitButton";

describe("phone schedule default action", () => {
  it("Quick Punch when non-Toast store and today", () => {
    expect(pickDefaultAction({ isToastLaborStore: false, isToday: true, hasSchedule: true })).toBe("quickPunch");
  });
  it("New Shift at a Toast store when a schedule exists", () => {
    expect(pickDefaultAction({ isToastLaborStore: true, isToday: true, hasSchedule: true })).toBe("newShift");
  });
  it("New Shift on a non-today day when a schedule exists", () => {
    expect(pickDefaultAction({ isToastLaborStore: false, isToday: false, hasSchedule: true })).toBe("newShift");
  });
  it("Build Week when no schedule and not punchable", () => {
    expect(pickDefaultAction({ isToastLaborStore: false, isToday: false, hasSchedule: false })).toBe("buildWeek");
  });
});
