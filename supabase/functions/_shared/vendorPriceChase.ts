// Shared price-chase logic — SINGLE SOURCE OF TRUTH for "what does this item cost".
//
// Used by:
//   - vendor-sync-nightly   (Stage 5 price fill, whole location)
//   - vendor-price-chase    (targeted resync from the unpriced counter button)
//
// Chain, per item, per location:
//   1. Master list  — pfg_bid_items (PFG bid guide) / pa_catalog_items (PA catalog),
//                     matched on ANY approved vendor number on the item's brand ID.
//   2. Orders       — last N days of pfg_orders line items.
//   3. Invoices     — last N days of pfg_invoices line items.
//   4. Nothing      — stamp unpriced_since, and discontinued_at if it fell off a
//                     master it used to be on AND had no recent activity.
//
// Rules (locked, Sep 1 2026):
//   - Never touches is_active. Tagging only. Deactivation is a human decision.
//   - An item priced off order/invoice history with no master row is a legit
//     off-bid ship-in (LTO / forced shipment) → ship_in_only = true, NOT unpriced.
//   - Order/invoice price is authoritative for ship-ins, not a consolation prize.

export const ACTIVITY_WINDOW_DAYS = 14;

export type PriceSource = "master" | "order" | "invoice";

export interface ChaseItem {
  id: string;
  name: string;
  item_number: string | null;
  pa_item_id: string | null;
  brand_item_id: string | null;
  cost_per_unit: number | null;
  unpriced_since: string | null;
  discontinued_at: string | null;
  ship_in_only: boolean | null;
  last_seen_on_bid_list?: string | null;
}

export interface ChaseResult {
  itemId: string;
  name: string;
  price: number | null;
  source: PriceSource | null;
  ref: string | null;
  date: string | null;
  shipInOnly: boolean;
  unpriced: boolean;
  discontinued: boolean;
}

export interface ChaseSummary {
  priced: number;
  unpriced: number;
  shipIns: number;
  discontinued: number;
  results: ChaseResult[];
}

const norm = (v: unknown) => String(v ?? "").trim();

/** Approved vendor numbers for a set of brand templates: template columns + brand_vendor_mappings. */
export async function loadApprovedNumbers(
  supabase: any,
  brandTemplateIds: string[],
): Promise<Map<string, { pfg: Set<string>; pa: Set<string> }>> {
  const out = new Map<string, { pfg: Set<string>; pa: Set<string> }>();
  const ids = brandTemplateIds.filter(Boolean);
  if (ids.length === 0) return out;

  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [tplRes, mapRes] = await Promise.all([
      supabase
        .from("brand_inventory_templates")
        .select("id, item_number, pa_item_id")
        .in("id", chunk),
      supabase
        .from("brand_vendor_mappings")
        .select("brand_template_id, vendor, vendor_item_id")
        .in("brand_template_id", chunk),
    ]);

    for (const t of (tplRes.data || []) as any[]) {
      const entry = out.get(t.id) || { pfg: new Set<string>(), pa: new Set<string>() };
      if (norm(t.item_number)) entry.pfg.add(norm(t.item_number));
      if (norm(t.pa_item_id)) entry.pa.add(norm(t.pa_item_id));
      out.set(t.id, entry);
    }
    for (const m of (mapRes.data || []) as any[]) {
      const entry = out.get(m.brand_template_id) || { pfg: new Set<string>(), pa: new Set<string>() };
      const vid = norm(m.vendor_item_id);
      if (!vid) continue;
      if (norm(m.vendor).toLowerCase() === "pa" || norm(m.vendor).toLowerCase() === "produce_alliance") {
        entry.pa.add(vid);
      } else {
        entry.pfg.add(vid);
      }
      out.set(m.brand_template_id, entry);
    }
  }
  return out;
}

interface PriceHit {
  price: number;
  source: PriceSource;
  ref: string | null;
  date: string | null;
}

/**
 * Chases prices for the given items at one location and writes the outcome back
 * to inventory_items. Returns a per-item summary for reporting.
 */
export async function chasePrices(
  supabase: any,
  locationId: string,
  items: ChaseItem[],
  opts: { windowDays?: number } = {},
): Promise<ChaseSummary> {
  const windowDays = opts.windowDays ?? ACTIVITY_WINDOW_DAYS;
  const results: ChaseResult[] = [];
  if (items.length === 0) {
    return { priced: 0, unpriced: 0, shipIns: 0, discontinued: 0, results };
  }

  const approved = await loadApprovedNumbers(
    supabase,
    items.map((i) => i.brand_item_id).filter(Boolean) as string[],
  );

  const numbersFor = (item: ChaseItem) => {
    const entry = item.brand_item_id ? approved.get(item.brand_item_id) : undefined;
    const pfg = new Set<string>(entry?.pfg ?? []);
    const pa = new Set<string>(entry?.pa ?? []);
    if (norm(item.item_number)) pfg.add(norm(item.item_number));
    if (norm(item.pa_item_id)) pa.add(norm(item.pa_item_id));
    return { pfg, pa };
  };

  // ---- Stage A: master lists for THIS location -----------------------------
  const [bidRes, paRes] = await Promise.all([
    supabase
      .from("pfg_bid_items")
      .select("item_number, unit_price, last_seen_at")
      .eq("location_id", locationId),
    supabase
      .from("pa_catalog_items")
      .select("pa_item_id, master_product_code, unit_price, last_seen_at")
      .eq("location_id", locationId),
  ]);

  const bidByNumber = new Map<string, { price: number | null; seen: string | null }>();
  for (const r of (bidRes.data || []) as any[]) {
    const n = norm(r.item_number);
    if (n) bidByNumber.set(n, { price: r.unit_price == null ? null : Number(r.unit_price), seen: r.last_seen_at });
  }
  const paByNumber = new Map<string, { price: number | null; seen: string | null }>();
  for (const r of (paRes.data || []) as any[]) {
    for (const key of [r.pa_item_id, r.master_product_code]) {
      const n = norm(key);
      if (n) paByNumber.set(n, { price: r.unit_price == null ? null : Number(r.unit_price), seen: r.last_seen_at });
    }
  }

  // ---- Stage B/C: recent order + invoice line items ------------------------
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

  const [ordersRes, invoicesRes] = await Promise.all([
    supabase
      .from("pfg_orders")
      .select("order_number, order_date, delivery_date, items")
      .eq("location_id", locationId)
      .gte("order_date", sinceIso)
      .order("order_date", { ascending: false }),
    supabase
      .from("pfg_invoices")
      .select("invoice_number, invoice_date, items")
      .eq("location_id", locationId)
      .gte("invoice_date", sinceIso)
      .order("invoice_date", { ascending: false }),
  ]);

  // Most-recent-wins: iterate newest first, keep first hit per number.
  const orderByNumber = new Map<string, PriceHit>();
  for (const o of (ordersRes.data || []) as any[]) {
    for (const li of Array.isArray(o.items) ? o.items : []) {
      const n = norm(li.itemNumber ?? li.productId);
      const price = Number(li.price ?? li.netPrice);
      if (!n || !Number.isFinite(price) || price <= 0) continue;
      if (!orderByNumber.has(n)) {
        orderByNumber.set(n, {
          price,
          source: "order",
          ref: norm(o.order_number) || null,
          date: (o.order_date ?? o.delivery_date) || null,
        });
      }
    }
  }
  const invoiceByNumber = new Map<string, PriceHit>();
  for (const inv of (invoicesRes.data || []) as any[]) {
    for (const li of Array.isArray(inv.items) ? inv.items : []) {
      const n = norm(li.itemNumber ?? li.productId);
      const price = Number(li.netPrice ?? li.price);
      if (!n || !Number.isFinite(price) || price <= 0) continue;
      if (!invoiceByNumber.has(n)) {
        invoiceByNumber.set(n, {
          price,
          source: "invoice",
          ref: norm(inv.invoice_number) || null,
          date: inv.invoice_date || null,
        });
      }
    }
  }

  const nowIso = new Date().toISOString();
  const masterEmpty = bidByNumber.size === 0 && paByNumber.size === 0;

  for (const item of items) {
    const { pfg, pa } = numbersFor(item);

    // No vendor number anywhere (house-made prep, sub-recipes, internal items).
    // Nothing to chase and nothing to tag — a vendor price was never expected.
    if (pfg.size === 0 && pa.size === 0) continue;


    let hit: PriceHit | null = null;
    let onMaster = false;

    // 1. Master list
    for (const n of pfg) {
      const row = bidByNumber.get(n);
      if (!row) continue;
      onMaster = true;
      if (row.price != null && row.price > 0) {
        hit = { price: row.price, source: "master", ref: n, date: row.seen ? row.seen.slice(0, 10) : null };
        break;
      }
    }
    if (!hit) {
      for (const n of pa) {
        const row = paByNumber.get(n);
        if (!row) continue;
        onMaster = true;
        if (row.price != null && row.price > 0) {
          hit = { price: row.price, source: "master", ref: n, date: row.seen ? row.seen.slice(0, 10) : null };
          break;
        }
      }
    }

    // 2. Orders
    if (!hit) {
      for (const n of [...pfg, ...pa]) {
        const o = orderByNumber.get(n);
        if (o) { hit = o; break; }
      }
    }
    // 3. Invoices
    if (!hit) {
      for (const n of [...pfg, ...pa]) {
        const inv = invoiceByNumber.get(n);
        if (inv) { hit = inv; break; }
      }
    }

    const hadActivity = [...pfg, ...pa].some((n) => orderByNumber.has(n) || invoiceByNumber.has(n));
    // Off-bid ship-in: real product, priced only by what actually shipped.
    const shipInOnly = !onMaster && hadActivity && !!hit && hit.source !== "master";
    // Discontinued: fell off a master it used to be on AND nothing shipped lately.
    // Never guess when we couldn't read a master this run.
    const discontinued =
      !masterEmpty && !onMaster && !hadActivity && !!item.last_seen_on_bid_list;

    const patch: Record<string, unknown> = {
      ship_in_only: shipInOnly,
      price_source: hit ? hit.source : null,
      price_source_ref: hit ? hit.ref : null,
      price_source_date: hit ? hit.date : null,
    };

    if (hit) {
      patch.cost_per_unit = hit.price;
      patch.last_synced_at = nowIso;
      patch.unpriced_since = null;
      patch.discontinued_at = discontinued ? (item.discontinued_at ?? nowIso) : null;
    } else {
      // Keep the first night we noticed, so the age tag is honest.
      patch.unpriced_since = item.unpriced_since ?? nowIso;
      patch.discontinued_at = discontinued ? (item.discontinued_at ?? nowIso) : item.discontinued_at ?? null;
    }

    await supabase.from("inventory_items").update(patch).eq("id", item.id);

    results.push({
      itemId: item.id,
      name: item.name,
      price: hit?.price ?? null,
      source: hit?.source ?? null,
      ref: hit?.ref ?? null,
      date: hit?.date ?? null,
      shipInOnly,
      unpriced: !hit,
      discontinued,
    });
  }

  return {
    priced: results.filter((r) => !r.unpriced).length,
    unpriced: results.filter((r) => r.unpriced).length,
    shipIns: results.filter((r) => r.shipInOnly).length,
    discontinued: results.filter((r) => r.discontinued).length,
    results,
  };
}

export const CHASE_SELECT =
  "id, name, item_number, pa_item_id, brand_item_id, cost_per_unit, unpriced_since, discontinued_at, ship_in_only, last_seen_on_bid_list";
