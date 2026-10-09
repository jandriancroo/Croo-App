import { afterEach, describe, expect, it, vi } from "vitest";
import { exportScheduleToPrint } from "./exportSchedulePrint";

afterEach(() => vi.restoreAllMocks());

describe("weekly station print order", () => {
  it("uses saved station order with Unassigned last and leaves source shifts intact", () => {
    const write = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ document: { write, close: vi.fn() } } as unknown as Window);
    const stations = ["Patio", "BOH"].map((name, sort_order) => ({ id: name, name, sort_order, location_id: "L", color: "", is_active: true }));
    const shifts = [
      { userId: "a", dayIndex: 0, startTime: "09:00", endTime: "12:00", isTimeOff: false, template: { station_id: "BOH" } },
      { userId: "a", dayIndex: 1, startTime: "09:00", endTime: "12:00", isTimeOff: false, station_id: "Patio" },
      { userId: "b", dayIndex: 0, startTime: "09:00", endTime: "12:00", isTimeOff: false },
    ];
    exportScheduleToPrint({ locationName: "Test", weekStart: new Date(2026, 9, 5), profiles: [{ id: "a", fullName: "A" }, { id: "b", fullName: "B" }], shifts, stations });
    const html = write.mock.calls[0]?.[0] as string;
    expect(html.indexOf('colspan="9">Patio')).toBeLessThan(html.indexOf('colspan="9">BOH'));
    expect(html.indexOf('colspan="9">BOH')).toBeLessThan(html.indexOf('colspan="9">Unassigned'));
    expect(shifts).toHaveLength(3);
    expect(shifts[0].template?.station_id).toBe("BOH");
  });
});