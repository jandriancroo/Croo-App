import { describe, it, expect } from "vitest";
import { effectiveStationId, groupShiftsByStation, groupPeopleByStation } from "./groupShiftsByStation";

const st = (id: string, sort = 0) => ({ id, location_id: "L", name: id.toUpperCase(), color: "#000", sort_order: sort, is_active: true });
const stations = [st("boh", 0), st("foh", 1)];

describe("effectiveStationId", () => {
  it("shift station wins over template", () => {
    expect(effectiveStationId({ station_id: "foh", template: { station_id: "boh" } })).toBe("foh");
  });
  it("falls back to template, then null", () => {
    expect(effectiveStationId({ station_id: null, template: { station_id: "boh" } })).toBe("boh");
    expect(effectiveStationId({ template: null })).toBeNull();
    expect(effectiveStationId(null)).toBeNull();
  });
});

describe("groupShiftsByStation", () => {
  it("buckets by effective station; inactive goes to Unassigned", () => {
    const shifts = [
      { id: "1", template: { station_id: "boh" } },
      { id: "2", station_id: "foh", template: { station_id: "boh" } },
      { id: "3", station_id: "gone" },
      { id: "4" },
    ];
    const g = groupShiftsByStation(shifts, stations);
    expect(g.map((s) => [s.station?.id ?? null, s.shifts.map((x) => x.id)])).toEqual([
      ["boh", ["1"]], ["foh", ["2"]], [null, ["3", "4"]],
    ]);
    expect(shifts).toHaveLength(4); // input untouched
  });
});

describe("groupPeopleByStation", () => {
  it("a person appears in each station they work, only with that station's shifts", () => {
    const people = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const shifts = [
      { id: "s1", user_id: "a", template: { station_id: "boh" } },
      { id: "s2", user_id: "a", station_id: "foh" },
      { id: "s3", user_id: "b" },
    ];
    const g = groupPeopleByStation(people, shifts, stations);
    const view = g.map((sec) => [sec.station?.id ?? null, sec.rows.map((r) => [r.person.id, r.shifts.map((x) => x.id)])]);
    expect(view).toEqual([
      ["boh", [["a", ["s1"]]]],
      ["foh", [["a", ["s2"]]]],
      [null, [["b", ["s3"]], ["c", []]]],
    ]);
    expect(g[2].shifts.map((x) => x.id)).toEqual(["s3"]);
  });
});
