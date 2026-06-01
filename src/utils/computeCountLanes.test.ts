import { describe, expect, it } from "vitest";
import { computeCountLanes } from "./computeCountLanes";

describe("computeCountLanes — shared lane decision for count screen + approval preview", () => {
  it("Toilet Seat Covers: lens 1/250 → Cases + Units (case tier comes from lens, not stale local=1)", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 1,
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
      lens: { count_units_per_case: 48, cost_per_common_unit: 1, common_unit: "ea", outer_type: "bag", inner_qty: 12 } as any,
    });

    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.showUnits).toBe(true);
    expect(lanes.innerLabel).toBe("Bags");
    expect(lanes.innerSubLabel).toBe("(12/bag)");
    expect(lanes.packQty).toBe(4);
    expect(lanes.innerPackQty).toBe(12);
    expect(lanes.costPerCase).toBe(48);
    expect(lanes.costPerPack).toBe(12);
    expect(lanes.costPerUnit).toBe(1);
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
      lens: { count_units_per_case: 1000, cost_per_common_unit: 0.025, common_unit: "ea", outer_type: "sleeve", inner_qty: 100 } as any,
    });

    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.showUnits).toBe(true);
    expect(lanes.innerLabel).toBe("Sleeves");
    expect(lanes.innerSubLabel).toBe("(100/sleeve)");
    expect(lanes.packQty).toBe(10);
    expect(lanes.innerPackQty).toBe(100);
  });

  it("Inner label falls back to lens.outer_type when no local override", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 10,
        unit: "ea",
        cost_per_unit: 25,
      },
      lens: { count_units_per_case: 1000, cost_per_common_unit: 0.025, common_unit: "ea", outer_type: "sleeve", inner_qty: 100 } as any,
    });

    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.innerLabel).toBe("Sleeves");
    expect(lanes.innerSubLabel).toBe("(100/sleeve)");
  });

  it("Italian Sausage: approved 8/5 lb config shows Cases + Bags + LBS even when local inner pack fields are stale", () => {
    const lanes = computeCountLanes({
      item: {
        pack_quantity: 8,
        inner_pack_quantity: null,
        inner_pack_label: null,
        unit: "cs",
        cost_per_unit: 98.65,
        count_by: "inherit",
      },
      lens: {
        count_units_per_case: 40,
        cost_per_common_unit: 2.46625,
        common_unit: "lb",
        outer_type: "bag",
        inner_qty: 5,
      } as any,
    });

    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.showUnits).toBe(true);
    expect(lanes.innerLabel).toBe("Bags");
    expect(lanes.innerSubLabel).toBe("(5 lb/bag)");
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

  it("Lens with cost=0 is still structurally valid (Option B) — Cases shown from lens pack tier", () => {
    // Under Option B, cost_per_common_unit is informational. Structural lens
    // validity is determined by count_units_per_case > 0 alone, so a 250-unit
    // case structure drives the Cases lane even when the reference price is 0.
    const lanes = computeCountLanes({
      item: { pack_quantity: 1, cost_per_unit: 5, count_by: "inherit" },
      lens: { count_units_per_case: 250, cost_per_common_unit: 0, common_unit: "ea" },
    });

    expect(lanes.showCases).toBe(true);
    expect(lanes.caseTierSource).toBe("lens");
  });

  // Real-DB-shape regressions — brand_pack_configs stores outer_type="case"
  // and inner_type="sleeve"/"lb"/"ea". Inner lane must pull from inner_type,
  // not outer_type; Cases-lane label must pull from outer_type.
  it("Real shape: Cold Cup Lids (case/sleeve) — middle lane labeled Sleeves, cases stays Cases", () => {
    const lanes = computeCountLanes({
      item: { pack_quantity: 10, inner_pack_quantity: 100, unit: "ea", cost_per_unit: 24.68, count_by: "inherit" },
      lens: { count_units_per_case: 1000, cost_per_common_unit: 0.025, common_unit: "ea", outer_type: "case", inner_qty: 100, inner_type: "sleeve" } as any,
    });
    expect(lanes.showInnerPacks).toBe(true);
    expect(lanes.innerLabel).toBe("Sleeves");
    expect(lanes.casesLabel).toBe("Cases");
  });

  it("Real shape: Salad Bowls (case/ea where inner==common) — inner lane suppressed", () => {
    const lanes = computeCountLanes({
      item: { pack_quantity: 6, inner_pack_quantity: 50, unit: "ea", cost_per_unit: 34.94, count_by: "inherit" },
      lens: { count_units_per_case: 300, cost_per_common_unit: 0.12, common_unit: "ea", outer_type: "case", inner_qty: 50, inner_type: "ea" } as any,
    });
    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(false);
    expect(lanes.casesLabel).toBe("Cases");
  });

  it("Real shape: Red Onions 4/5 lb (bag/lb where inner==common) — cases labeled Bags, no inner lane", () => {
    const lanes = computeCountLanes({
      item: { pack_quantity: 4, inner_pack_quantity: 5, inner_pack_label: "lb", unit: "lb", cost_per_unit: 14.16, count_by: "inherit" },
      lens: { count_units_per_case: 20, cost_per_common_unit: 0.71, common_unit: "lb", outer_type: "bag", inner_qty: 5, inner_type: "lb" } as any,
    });
    expect(lanes.showCases).toBe(true);
    expect(lanes.showInnerPacks).toBe(false);
    expect(lanes.casesLabel).toBe("Bags");
  });
});

