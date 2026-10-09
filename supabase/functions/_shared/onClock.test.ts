import { describe, it, expect } from "vitest";
import { toastOnClockIds } from "./onClock";

const now = Date.parse("2026-10-09T19:00:00Z");
const h = (n: number) => new Date(now - n * 3600_000).toISOString();

describe("toastOnClockIds", () => {
  it("keeps open + paired only, skipping unpaired, closed and >24h", () => {
    const ids = toastOnClockIds([
      { croo_user_id: "a", in_time: h(2), out_time: null },
      { croo_user_id: null, in_time: h(1), out_time: null },
      { croo_user_id: "c", in_time: h(5), out_time: h(1) },
      { croo_user_id: "d", in_time: h(25), out_time: null },
      { croo_user_id: "a", in_time: h(3), out_time: null },
    ], now);
    expect(ids).toEqual(["a"]);
  });
  it("empty in, empty out", () => expect(toastOnClockIds([], now)).toEqual([]));
});
