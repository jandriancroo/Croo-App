import { describe, it, expect } from "vitest";
import { transferLineValue, transferLinesTotal } from "./transferValue";

describe("transferLineValue", () => {
  const lines = [
    { quantity: 5, unit_type: "unit", cost_per_unit: 41.93, pack_quantity: 24 }, // Diet Coke
    { quantity: 3, unit_type: "unit", cost_per_unit: 40.86, pack_quantity: 4 }, // Banana Peppers
    { quantity: 1, unit_type: "unit", cost_per_unit: 33.27, pack_quantity: 4 }, // Jalapeno
    { quantity: 1, unit_type: "unit", cost_per_unit: 28.6, pack_quantity: 4 }, // Croutons
    { quantity: 1, unit_type: "unit", cost_per_unit: 179.15, pack_quantity: 1 }, // EVOO
    { quantity: 2, unit_type: "case", cost_per_unit: 52.45, pack_quantity: 6 }, // Shredded Mozz
    { quantity: 1, unit_type: "case", cost_per_unit: 22.25, pack_quantity: 6 }, // Fresh Mozz
    { quantity: 1, unit_type: "case", cost_per_unit: 79.45, pack_quantity: 1 }, // Yeast
  ];

  it("divides unit lines by pack, leaves case lines at case cost", () => {
    expect(transferLineValue(lines[0])).toBeCloseTo(8.735, 3);
    expect(transferLineValue(lines[1])).toBeCloseTo(30.645, 3);
    expect(transferLineValue(lines[5])).toBeCloseTo(104.9, 3);
  });

  it("totals the Palm Desert -> Palm Springs sample", () => {
    expect(transferLinesTotal(lines)).toBeCloseTo(440.6, 1);
  });

  it("treats missing/zero pack as 1", () => {
    expect(transferLineValue({ quantity: 2, unit_type: "unit", cost_per_unit: 10, pack_quantity: null })).toBe(20);
  });
});
