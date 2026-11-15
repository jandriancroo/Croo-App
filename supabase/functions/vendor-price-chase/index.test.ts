import { assertEquals } from "jsr:@std/assert@1";
import { scopeItemQuery } from "./scope.ts";
import { activationDecision, chasePrices } from "../_shared/vendorPriceChase.ts";

function recorder() {
  const calls: [string, string][] = [];
  const q: any = { eq(c: string, v: string) { calls.push([c, v]); return q; } };
  return { q, calls };
}

Deno.test("templateId scopes to store + that template only", () => {
  const { q, calls } = recorder();
  scopeItemQuery(q, "loc-1", "tpl-9");
  assertEquals(calls, [["location_id", "loc-1"], ["brand_item_id", "tpl-9"]]);
});

Deno.test("no templateId keeps store-only scope", () => {
  const { q, calls } = recorder();
  scopeItemQuery(q, "loc-1", null);
  assertEquals(calls, [["location_id", "loc-1"]]);
});

const live = new Set(["tpl"]);
const now = new Date().toISOString();
const since = new Date(Date.now() - 30 * 60_000).toISOString();
const base = { id: "i", name: "n", item_number: null, pa_item_id: null, brand_item_id: "tpl",
  cost_per_unit: null, unpriced_since: null, discontinued_at: null, ship_in_only: null };

Deno.test("block reasons", () => {
  assertEquals(activationDecision({ ...base, is_active: true }, live, since), "already_active");
  assertEquals(activationDecision({ ...base, is_active: false, deactivated_by: "manager" }, live), "manager_deactivated");
  assertEquals(activationDecision({ ...base, is_active: false, deactivated_by: "system" }, live), "manager_deactivated");
  const old = new Date(Date.now() - 2 * 3600_000).toISOString();
  assertEquals(activationDecision({ ...base, is_active: false, created_at: old }, live, since), "already_exists");
  assertEquals(activationDecision({ ...base, is_active: false, created_at: old }, live), null); // window only with templateId
  assertEquals(activationDecision({ ...base, is_active: false, created_at: now }, live, since), null);
  assertEquals(activationDecision({ ...base, is_active: false, created_at: now, brand_item_id: null }, live, since), "no_brand_link");
  assertEquals(activationDecision({ ...base, is_active: false, created_at: now, brand_item_id: "x" }, live, since), "template_not_live");
});

// Stub client: reads return rows[table] ?? [], writes are recorded.
function stubClient(writes: any[], rows: Record<string, any[]> = {}) {
  const chain = (table: string): any => {
    const p: any = new Proxy({}, {
      get(_t, k) {
        if (k === "then") return (r: any) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(r);
        if (k === "update") return (patch: any) => { writes.push({ table, patch }); return p; };
        return () => p;
      },
    });
    return p;
  };
  return { from: chain };
}

const houseMade = (extra: any) => ({ ...base, vendor_source: null, ...extra });

Deno.test("nightly path (no activateOnHit) never writes is_active", async () => {
  const writes: any[] = [];
  await chasePrices(stubClient(writes), "loc", [houseMade({ is_active: false, created_at: now })]);
  assertEquals(writes.filter((w) => "is_active" in w.patch).length, 0);
});

Deno.test("house-made: manager-deactivated / already-active get no update", async () => {
  const writes: any[] = [];
  const s = await chasePrices(stubClient(writes), "loc", [
    houseMade({ id: "a", is_active: false, deactivated_by: "manager", created_at: now }),
    houseMade({ id: "b", is_active: true, created_at: now }),
  ], { activateOnHit: true, newRowSince: since });
  assertEquals(writes.length, 0);
  assertEquals(s.skips.map((k) => k.reason), ["manager_deactivated"]); // already_active not listed
});

const pfgItem = (extra: any) => ({ ...base, item_number: "123", vendor_source: "pfg", ...extra });
const bid = { pfg_bid_items: [{ item_number: "123", unit_price: 9.5, last_seen_at: now }],
  brand_inventory_templates: [{ id: "tpl", status: "live" }] };

Deno.test("price hit: new row switches on; old/manager/active rows keep is_active", async () => {
  const writes: any[] = [];
  const old = new Date(Date.now() - 2 * 3600_000).toISOString();
  await chasePrices(stubClient(writes, bid), "loc", [
    pfgItem({ id: "new", is_active: false, created_at: now }),
    pfgItem({ id: "old", is_active: false, created_at: old }),
    pfgItem({ id: "mgr", is_active: false, deactivated_by: "manager", created_at: now }),
    pfgItem({ id: "on", is_active: true, created_at: now }),
  ], { activateOnHit: true, newRowSince: since });
  const inv = writes.filter((w) => w.table === "inventory_items");
  assertEquals(inv.length, 4); // price refresh still happens for all
  assertEquals(inv.filter((w) => w.patch.is_active === true).length, 1);
});

Deno.test("nightly price hit never writes is_active", async () => {
  const writes: any[] = [];
  await chasePrices(stubClient(writes, bid), "loc", [pfgItem({ is_active: false, created_at: now })]);
  assertEquals(writes.filter((w) => "is_active" in w.patch).length, 0);
});
