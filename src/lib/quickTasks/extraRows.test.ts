import { describe, it, expect } from "vitest";
import { cashTaskWindows, spotCheckWindow, splitExtraRows } from "./extraRows";

const base = { openMin: 10 * 60, closeMin: 21 * 60, amSubmitted: false, pmSubmitted: false, depositSubmitted: false };

describe("cash count windows (unchanged rules)", () => {
  it("AM safe shows from 2h before open to 2h after open", () => {
    expect(cashTaskWindows({ ...base, nowMin: 8 * 60 }).showAm).toBe(true);
    expect(cashTaskWindows({ ...base, nowMin: 12 * 60 }).showAm).toBe(true);
    expect(cashTaskWindows({ ...base, nowMin: 7 * 60 + 59 }).showAm).toBe(false);
    expect(cashTaskWindows({ ...base, nowMin: 12 * 60 + 1 }).showAm).toBe(false);
  });
  it("PM safe and drawer show from close to close+2h", () => {
    const w = cashTaskWindows({ ...base, nowMin: 22 * 60 });
    expect(w.showPm && w.showDeposit).toBe(true);
    expect(cashTaskWindows({ ...base, nowMin: 20 * 60 + 59 }).showPm).toBe(false);
    expect(cashTaskWindows({ ...base, nowMin: 23 * 60 + 1 }).showDeposit).toBe(false);
  });
  it("hides counts already submitted today", () => {
    const w = cashTaskWindows({ ...base, nowMin: 22 * 60, pmSubmitted: true, depositSubmitted: true });
    expect(w.showPm || w.showDeposit).toBe(false);
  });
  it("is overdue only in the last 30 minutes", () => {
    expect(cashTaskWindows({ ...base, nowMin: 22 * 60 + 29 }).pmOverdue).toBe(false);
    expect(cashTaskWindows({ ...base, nowMin: 22 * 60 + 30 }).pmOverdue).toBe(true);
  });
});

describe("spot check window", () => {
  it("close to close+2h", () => {
    expect(spotCheckWindow(21 * 60, 21 * 60).show).toBe(true);
    expect(spotCheckWindow(21 * 60, 23 * 60 + 1).show).toBe(false);
  });
});

describe("row order groups", () => {
  it("splits red, amber, teal", () => {
    const r = (key: string, wash: "red" | "amber" | "teal") => ({ key, title: key, icon: (() => null) as any, wash, overdue: false, onSelect: () => {} });
    const s = splitExtraRows([r("cash", "teal"), r("pin", "red"), r("doc", "amber")]);
    expect([s.red[0].key, s.amber[0].key, s.teal[0].key]).toEqual(["pin", "doc", "cash"]);
  });
});
