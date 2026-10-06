import { describe, it, expect } from "vitest";
import { interpretHeimark, readHeimarkPack } from "../../supabase/functions/_shared/invoiceProfiles/heimarkRules";
import { chooseProfile, normalizeVendorName } from "../../supabase/functions/_shared/invoiceProfiles/index";

// Hand-read and checked by Jordan: Heimark #235013, PS, delivered Sep 28 2026.
const FIXTURE = {
  vendor_name: "Heimark Distributing, LLC",
  invoice_number: "235013",
  invoice_date: "2026-09-28",
  lines: [
    { item_number: "10351", quantity: 1, description: "BUD LT 24/16CALNR2/12", price: 28.9, discount: 5.55, crv_deposit: 1.2, amount: 24.55 },
    { item_number: "11451", quantity: 2, description: "MICH ULT 24/16CALNR2/12", price: 33.5, discount: 4.95, crv_deposit: 1.2, amount: 59.5 },
    { item_number: "13636", quantity: 2, description: "ESTRELLA 24/12NR LOOSE", price: 22.95, discount: 2.35, crv_deposit: 1.2, amount: 43.6 },
    { item_number: "37745", quantity: 2, description: "STELLA 24/11.2 LOOSE", price: 28.65, discount: 3.8, crv_deposit: 1.2, amount: 52.1 },
    { item_number: "41242", quantity: 1, description: "LQ POOLSD 6/4CN", price: 47.0, discount: 0, crv_deposit: 1.2, amount: 48.2 },
    { item_number: "70935", quantity: 4, description: "FIRESTN 805 2/12NR", price: 32.3, discount: 2.3, crv_deposit: 1.2, amount: 124.8 },
  ],
  footer: {
    total_crv_units: 288, total_crv_dollars: 14.4, cases: 12, gallons: 29.7,
    content_dollars: 375.3, deposit_dollars: 14.4, discount_dollars: 36.95, invoice_total: 352.75,
  },
};

describe("Heimark profile", () => {
  it("is chosen for both spellings of the vendor and nobody else", () => {
    expect(normalizeVendorName("HEIMARK DISTRIBUTING, LLC")).toBe("heimark");
    expect(chooseProfile("Heimark Distributing, LLC")).toBe("heimark");
    expect(chooseProfile("Performance Foodservice")).toBe("default");
    expect(chooseProfile("Produce Alliance")).toBe("default");
    expect(chooseProfile(null)).toBe("default");
  });

  it("reads #235013 exactly as hand-checked", () => {
    const r = interpretHeimark(FIXTURE);
    expect(r.ok).toBe(true);
    const by = Object.fromEntries(r.lines.map((l) => [l.item_number, l]));
    expect(by["10351"].cost_per_case).toBe(24.55);
    expect(by["10351"].pack).toMatchObject({ units_per_case: 24, oz_per_unit: 16, inner_layout: "2/12", pack_size: "24/16 OZ 2/12" });
    expect(by["11451"].cost_per_case).toBe(29.75);
    expect(by["13636"].pack).toMatchObject({ oz_per_unit: 12, inner_layout: "LOOSE" });
    expect(by["37745"].pack).toMatchObject({ oz_per_unit: 11.2, inner_layout: "LOOSE" });
    expect(by["41242"].pack).toMatchObject({ units_per_case: 24, oz_per_unit: null, inner_layout: "6/4", container: "can" });
    expect(by["70935"].pack).toMatchObject({ units_per_case: 24, inner_layout: "2/12" });
    expect(by["70935"].cost_per_case).toBe(31.2);
  });

  it("fails review on a wrong total and on a misread amount", () => {
    expect(interpretHeimark({ ...FIXTURE, footer: { ...FIXTURE.footer, invoice_total: 350 } }).ok).toBe(false);
    const bad = { ...FIXTURE, lines: FIXTURE.lines.map((l, i) => (i === 0 ? { ...l, amount: 25.55 } : l)) };
    expect(interpretHeimark(bad).ok).toBe(false);
  });

  it("fails review when the footer wasn't read", () => {
    expect(interpretHeimark({ ...FIXTURE, footer: {} }).ok).toBe(false);
  });

  it("uses CRV to decide the pack form", () => {
    expect(readHeimarkPack("ESTRELLA 4/6", 1.2)).toMatchObject({ units_per_case: 24, inner_layout: "4/6" });
    expect(readHeimarkPack("SOMETHING 24/12", 0.6).problem).not.toBeNull();
    expect(readHeimarkPack("NO PACK", 1.2).problem).not.toBeNull();
    expect(readHeimarkPack("BUD LT 24/16", 0).problem).not.toBeNull();
  });
});

describe("Heimark profile, cases found in the dry run", () => {
  it("reads millilitres and ounces printed after the layout", () => {
    expect(readHeimarkPack("PELLEGRINO 24/500ML", 1.2)).toMatchObject({ units_per_case: 24, pack_size: "24/500 ML", oz_per_unit: 16.91 });
    expect(readHeimarkPack("STELLA 4/6 NR 11.2Z", 1.2)).toMatchObject({ inner_layout: "4/6", oz_per_unit: 11.2 });
    expect(readHeimarkPack("G2G FRTPUN 12/6 OZ", 0.6)).toMatchObject({ units_per_case: 12, oz_per_unit: 6 });
    expect(readHeimarkPack("MICH ULT 18/12 NR", 0.9)).toMatchObject({ units_per_case: 18, oz_per_unit: 12 });
  });
  it("leaves out note lines and zero-quantity lines", () => {
    const r = interpretHeimark({
      lines: [
        { item_number: "70935", quantity: 1, description: "FIRESTN 805 2/12NR", price: 32.3, discount: 2.3, crv_deposit: 1.2, amount: 31.2 },
        { item_number: "-2", quantity: 15, description: "MISPICK", price: 0, discount: 0, crv_deposit: 0, amount: 0 },
        { item_number: "41242", quantity: 0, description: "LQ POOLSD 6/4CN", price: 47, discount: 0, crv_deposit: 1.2, amount: 0 },
      ],
      footer: { total_crv_units: 24, cases: 1, content_dollars: 32.3, deposit_dollars: 1.2, discount_dollars: 2.3, invoice_total: 31.2 },
    });
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.item_number)).toEqual(["70935"]);
  });
});
