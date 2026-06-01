import { describe, it, expect } from "vitest";
import { computeCountLanes } from "./computeCountLanes";

describe("computeCountLanes — shared lane decision for count screen + approval preview", () => {
  it("Toilet Seat Covers: lens 1/250 → Cases + Units (case tier comes from lens, not stale local=1)", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 1, // stale local
        inner_pack_quantity: null,
        unit: "ea",
        cost_per_unit: 6.67,
        count_by: "inherit",
      },
      lens: { count_units_per_case: 250, cost_per_common_unit: 0.02668, common_unit: "ea" },
    });
    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(false);
    expect(lanes.showUnits).toBe(true);
    expect(lanes.casesLabel).toBe("Cases");
    expect(lanes.packQty).toBe(250);
    expect(lanes.caseTierSource).toBe("lens");
  });

  it("Artichokes (or similar three-tier): Cases + middle Bags lane + Units", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 4,
        inner_pack_quantity: 12,
        inner_pack_label: "bag",
        unit: "ea",
        cost_per_unit: 48,
        count_by: "inherit",
      },
      lens: { count_units_per_case: 48, cost_per_common_unit: 1.0, common_unit: "ea", outer_type: "bag" } as any,
    });
    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.showUnits).toBe(true);
    expect(lanes.innerLabel).toBe("Bags");
    expect(lanes.innerSubLabel).toBe("(12 ea/bag)");
    expect(lanes.costPerCase).toBe(48);
    expect(lanes.costPerPack).toBe(12); // 48 / 4 packs
    expect(lanes.costPerUnit).toBe(1); // 48 / 48 total units
  });

  it("Recipe item: single counting lane (no case/inner/units grid)", () => {
    const lanes = computeCountLanes({
      item: { is_recipe: true, unit: "lb", cost_per_unit: 3.5 },
    });
    expect(lanes.isRecipe).toBe(true);
    expect(lanes.showInnerPacks).toBe(false);
    expect(lanes.showUnits).toBe(false);
    expect(lanes.casesLabel).toBe("Count (lb)");
    expect(lanes.caseTierSource).toBe("recipe");
  });

  it("Cold Cup Lids: case=10, inner sleeves of 100 lids → Cases + Sleeves + Lids (Units)", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 10,
        inner_pack_quantity: 100,
        inner_pack_label: "sleeve",
        unit: "ea",
        cost_per_unit: 25,
        count_by: "inherit",
      },
      lens: { count_units_per_case: 1000, cost_per_common_unit: 0.025, common_unit: "ea", outer_type: "sleeve" } as any,
    });
    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.showUnits).toBe(true);
    expect(lanes.innerLabel).toBe("Sleeves");
    expect(lanes.innerSubLabel).toBe("(100 ea/sleeve)");
    expect(lanes.packQty).toBe(1000); // lens-driven
  });

  it("Inner label falls back to lens.inner_type when no local override", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 10,
        // inner_pack_label intentionally omitted
        unit: "ea",
        cost_per_unit: 25,
      },
      lens: { count_units_per_case: 1000, cost_per_common_unit: 0.025, common_unit: "ea", outer_type: "sleeve", inner_qty: 100 } as any,
    });
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.innerLabel).toBe("Sleeves");
    expect(lanes.innerSubLabel).toBe("(100 ea/sleeve)");
  });

  it("count_by='units_only' hides Cases even when lens has case tier", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 10,
        inner_pack_quantity: null,
        cost_per_unit: 25,
        count_by: "units_only",
      },
      lens: { count_units_per_case: 250, cost_per_common_unit: 0.1, common_unit: "ea" },
    });
    expect(lanes.showCases).toBe(false);
    expect(lanes.showUnits).toBe(true);
  });

  it("Invalid lens (cost=0) falls back to local — Cases only shown when local pack > 1", () => {
    const lanesStaleLocal = computeCountLanes({
      item: { pack_quantity: 1, cost_per_unit: 5, count_by: "inherit" },
      lens: { count_units_per_case: 250, cost_per_common_unit: 0, common_unit: "ea" },
    });
    expect(lanesStaleLocal.showCases).toBe(false); // local true single unit
    expect(lanesStaleLocal.caseTierSource).toBe("local");
  });
});
