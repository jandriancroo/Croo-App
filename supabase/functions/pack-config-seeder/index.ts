// Pack-config seeder — refactored per item-lifecycle-spec.md piece #6.
// Redeploy trigger: 2026-06-22 parser fix A (trailing-period + unit-only).
//
// Walks every (brand_template, location) pair where an active inventory_items
// row exists, resolves pack + cost from the mapped vendor's sources at that
// location, applies brand-level pack overrides, and emits proposals to
// brand_pack_configs + ledger rows to location_pack_seen_ledger.
//
// Resolution rules (option (a) — invoice augmentation DROPPED this session;
// vendor_invoice_items lacks a pack_size column, see follow-up ticket):
//   - PFG mapping → pfg_bid_items (preferred) then pfg_orders fallback.
//   - PA mapping  → pa_catalog_items (preferred) then pa_orders fallback.
//   - Heimark / other non-PFG/PA mapping → no source, will land in
//     needs_source_evidence.
//   - No mapping at all → skip, log to needs_vendor_mapping report.
//   - Mapping exists but zero source evidence → skip (hard-whitelist),
//     log to needs_source_evidence report.
//
// Deferred reports (needs_vendor_mapping, needs_source_evidence) are enriched
// with most-recent invoice context from vendor_invoice_items joined through
// vendor_invoices (last 90 days). This turns the deferred list into something
// manually triageable in minutes — invoice product_name often contains pack
// structure inline ("MOZZARELLA SHREDDED 6/5LB CASE"). no_invoice_history=true
// flags templates with zero invoice trace at all.
//
// Source-of-truth audit lives in brand_pack_configs.source_evidence JSONB:
//   { source, vendor, vendor_item_id, parsed_pack, pack_override_applied,
//     final_pack, cost_basis }
//
// Dry-run = no writes anywhere (no proposals, no ledger). Buckets returned
// in the response payload for Checkpoint A review.


import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parsePackString } from "../_shared/packParser.ts";
import { filterEnabledLocations } from "../_shared/inventoryGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Window lookbacks ──
const PFG_BID_LOOKBACK_DAYS = 30;
const PFG_ORDER_LOOKBACK_DAYS = 90;
const PA_CATALOG_LOOKBACK_DAYS = 30;
const PA_ORDER_LOOKBACK_DAYS = 90;
const INVOICE_LOOKBACK_DAYS = 90;

// ── Vendor key normalization ──
// Canonical vendor identifiers used everywhere downstream.
function normalizeVendor(v: string | null | undefined): 'pfg' | 'pa' | 'heimark' | 'other' | null {
  if (!v) return null;
  const lc = String(v).trim().toLowerCase();
  if (lc === 'pfg') return 'pfg';
  if (lc === 'pa' || lc === 'produce_alliance') return 'pa';
  if (lc === 'heimark') return 'heimark';
  return 'other';
}

type ParsedPack = {
  outer_qty: number;
  outer_type: string;
  inner_qty: number;
  inner_type: string;
  common_unit: string;
};

type ResolvedSource = {
  source: 'pfg_bid' | 'pfg_order' | 'pa_catalog' | 'pa_order' | 'invoice';
  vendor: string;
  vendor_item_id: string;
  parsed: ParsedPack;
  cost_per_case: number | null;
  raw_pack_string: string;
  observed_at: string | null;
  label?: string | null;
};

type ProposalCandidate = {
  brand_template_id: string;
  vendor: string;
  vendor_item_id: string;
  outer_qty: number;
  outer_type: string;
  inner_qty: number;
  inner_type: string;
  common_unit: string;
  count_units_per_case: number;
  cost_per_common_unit: number | null;
  label: string | null;
  source: string;
  source_evidence: Record<string, any>;
  // Ledger tie-in
  location_id: string;
  pack_structure_key: string;
};

function structureKey(p: { outer_qty: number; inner_qty: number; common_unit: string }) {
  return `${p.outer_qty}::${p.inner_qty ?? 0}::${p.common_unit}`;
}
// Pack-size suggestion label, e.g. "10/100 ea", "1/5 lb", "6 ea" (when no inner_qty).
// MUST be a pack descriptor — never a product name. See backfill 2026-06-09.
function formatPackLabel(p: { outer_qty: number; inner_qty: number | null | undefined; common_unit: string }): string {
  const unit = String(p.common_unit || '').toLowerCase();
  if (p.inner_qty != null && Number(p.inner_qty) > 0) {
    return `${p.outer_qty}/${p.inner_qty} ${unit}`.trim();
  }
  return `${p.outer_qty} ${unit}`.trim();
}

// FULL dedup key — includes vendor + vendor_item_id so two genuinely-different
// SKUs that happen to share total units/case do NOT collapse into one proposal.
function candidateDedupKey(c: { brand_template_id: string; vendor: string; vendor_item_id: string; count_units_per_case: number; common_unit: string }) {
  return `${c.brand_template_id}::${c.vendor}::${c.vendor_item_id}::${Number(c.count_units_per_case)}::${String(c.common_unit).toLowerCase()}`;
}
// LEGACY dedup key — for matching pre-vendor_item_id approved rows. On match,
// the seeder stamps the candidate's SKU back onto the approved row.
function legacyDedupKey(c: { brand_template_id: string; count_units_per_case: number; common_unit: string }) {
  return `${c.brand_template_id}::${Number(c.count_units_per_case)}::${String(c.common_unit).toLowerCase()}`;
}
// SKU key — (template, vendor, sku). Used to short-circuit ANY new proposal
// when an approved config already exists for the same vendor SKU on the same
// template. Human-approved structure wins; only emit a fresh proposal when
// the vendor reports a genuinely different pack structure.
function approvedSkuKey(c: { brand_template_id: string; vendor: string; vendor_item_id: string }) {
  return `${c.brand_template_id}::${c.vendor}::${c.vendor_item_id}`;
}
// Unit aliases — pack parser emits short codes (ga, gm) while older approved
// rows used long forms (gal, g). Normalize before structure comparison so we
// don't generate proposals over cosmetic unit-string differences.
function normUnit(u: string | null | undefined): string {
  const s = String(u ?? '').toLowerCase().trim();
  if (s === 'ga' || s === 'gal' || s === 'gallon' || s === 'gallons') return 'gal';
  if (s === 'g' || s === 'gm' || s === 'gram' || s === 'grams') return 'g';
  if (s === 'kg' || s === 'kilo' || s === 'kilogram' || s === 'kilograms') return 'kg';
  if (s === 'lb' || s === 'lbs' || s === 'pound' || s === 'pounds') return 'lb';
  if (s === 'oz' || s === 'ounce' || s === 'ounces') return 'oz';
  if (s === 'ea' || s === 'each' || s === 'ct' || s === 'count') return 'ea';
  return s;
}
function structuresMatch(
  a: { count_units_per_case: number | null; common_unit: string | null },
  b: { count_units_per_case: number | null; common_unit: string | null },
): boolean {
  const ac = Number(a.count_units_per_case ?? 0);
  const bc = Number(b.count_units_per_case ?? 0);
  return Math.round(ac * 100) === Math.round(bc * 100) && normUnit(a.common_unit) === normUnit(b.common_unit);
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") !== "false"; // DEFAULT TRUE — safety
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // ── Query A: eligible templates ──
    // EXCLUDES: recipes, and templates literally named "Water" (costless ingredient).
    // TODO: replace name-based Water exclusion with a proper `costless_ingredient`
    // boolean on brand_inventory_templates (separate from is_recipe). For now,
    // name match is the smallest blast-radius fix.
    const { data: templates, error: tErr } = await supabase
      .from("brand_inventory_templates")
      .select("id, product_name, brand_id, status, is_recipe")
      .in("status", ["live", "draft"])
      .or("is_recipe.is.null,is_recipe.eq.false");
    if (tErr) throw tErr;
    const eligibleTemplateIds = new Set<string>(
      (templates || [])
        .filter((t: any) => String(t.product_name ?? '').trim().toLowerCase() !== 'water')
        .map((t: any) => t.id)
    );


    // ── Query B: vendor mappings per template ──
    const { data: mappings, error: mErr } = await supabase
      .from("brand_vendor_mappings")
      .select("brand_template_id, vendor, vendor_item_id, pack_override_outer_qty, pack_override_outer_type, pack_override_inner_qty, pack_override_inner_type");
    if (mErr) throw mErr;

    type Mapping = {
      vendor: 'pfg' | 'pa' | 'heimark' | 'other';
      vendor_item_id: string;
      override: {
        outer_qty: number | null;
        outer_type: string | null;
        inner_qty: number | null;
        inner_type: string | null;
      };
    };
    const mappingsByTemplate = new Map<string, Mapping[]>();
    const templatesWithMultipleMappings = new Set<string>();
    for (const m of (mappings || [])) {
      if (!eligibleTemplateIds.has(m.brand_template_id)) continue;
      const v = normalizeVendor(m.vendor);
      if (!v) continue;
      const arr = mappingsByTemplate.get(m.brand_template_id) ?? [];
      arr.push({
        vendor: v,
        vendor_item_id: String(m.vendor_item_id),
        override: {
          outer_qty: m.pack_override_outer_qty ?? null,
          outer_type: m.pack_override_outer_type ?? null,
          inner_qty: m.pack_override_inner_qty ?? null,
          inner_type: m.pack_override_inner_type ?? null,
        },
      });
      mappingsByTemplate.set(m.brand_template_id, arr);
      if (arr.length > 1) templatesWithMultipleMappings.add(m.brand_template_id);
    }

    // ── Query C: active inventory_items per (template, location) ──
    // Paginated — count exceeds the PostgREST default 1000-row cap.
    const invItems: { brand_item_id: string; location_id: string; is_active: boolean }[] = [];
    {
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("inventory_items")
          .select("brand_item_id, location_id, is_active")
          .eq("is_active", true)
          .not("brand_item_id", "is", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        invItems.push(...batch as any);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
    }


    const locationsByTemplate = new Map<string, Set<string>>();
    for (const r of (invItems || [])) {
      if (!eligibleTemplateIds.has(r.brand_item_id)) continue;
      if (!r.location_id) continue;
      let set = locationsByTemplate.get(r.brand_item_id);
      if (!set) { set = new Set(); locationsByTemplate.set(r.brand_item_id, set); }
      set.add(r.location_id);
    }

    // Gate: prune disabled locations across all templates
    const allLocIds = new Set<string>();
    for (const s of locationsByTemplate.values()) for (const id of s) allLocIds.add(id);
    const enabledLocIds = await filterEnabledLocations(supabase, [...allLocIds]);
    let prunedLocCount = 0;
    for (const [tplId, locs] of locationsByTemplate) {
      const filtered = new Set<string>();
      for (const id of locs) {
        if (enabledLocIds.has(id)) filtered.add(id);
        else prunedLocCount++;
      }
      locationsByTemplate.set(tplId, filtered);
    }
    if (prunedLocCount > 0) console.log(`[pack-config-seeder] Pruned ${prunedLocCount} template/location pairs — inventory_enabled=false`);


    // ── Preload source tables (in-memory indexes) ──
    const nowMs = Date.now();
    const cutoffISO = (days: number) => new Date(nowMs - days * 86400_000).toISOString();

    // PFG bids — most recent per (location, item)
    const { data: pfgBids } = await supabase
      .from("pfg_bid_items")
      .select("location_id, item_number, pack_size, unit_price, description, last_seen_at")
      .gte("last_seen_at", cutoffISO(PFG_BID_LOOKBACK_DAYS));
    const pfgBidIdx = new Map<string, any>(); // key: location_id::item_number
    for (const b of (pfgBids || [])) {
      if (!b.location_id || !b.item_number) continue;
      const k = `${b.location_id}::${String(b.item_number)}`;
      const prior = pfgBidIdx.get(k);
      if (!prior || (b.last_seen_at && b.last_seen_at > (prior.last_seen_at ?? ''))) {
        pfgBidIdx.set(k, b);
      }
    }


    // PFG orders — extract items[]; most recent per (location, itemNumber)
    const { data: pfgOrders } = await supabase
      .from("pfg_orders")
      .select("location_id, order_date, items")
      .gte("order_date", cutoffISO(PFG_ORDER_LOOKBACK_DAYS));
    const pfgOrderIdx = new Map<string, any>(); // key: location_id::itemNumber
    for (const o of (pfgOrders || [])) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const sku = it?.itemNumber ?? it?.item_number;
        if (!o.location_id || !sku) continue;
        const k = `${o.location_id}::${String(sku)}`;
        const prior = pfgOrderIdx.get(k);
        if (!prior || (o.order_date && o.order_date > (prior._order_date ?? ''))) {
          pfgOrderIdx.set(k, { ...it, _order_date: o.order_date });
        }
      }
    }

    // PA catalog — most recent per (location, pa_item_id)
    const { data: paCatalog } = await supabase
      .from("pa_catalog_items")
      .select("location_id, pa_item_id, pack_size, unit_price, description, last_seen_at")
      .gte("last_seen_at", cutoffISO(PA_CATALOG_LOOKBACK_DAYS));
    const paCatalogIdx = new Map<string, any>(); // key: location_id::pa_item_id
    for (const c of (paCatalog || [])) {
      if (!c.location_id || c.pa_item_id == null) continue;
      const k = `${c.location_id}::${String(c.pa_item_id)}`;
      const prior = paCatalogIdx.get(k);
      if (!prior || (c.last_seen_at && c.last_seen_at > (prior.last_seen_at ?? ''))) {
        paCatalogIdx.set(k, c);
      }
    }


    // PA orders — extract items[]; key by pa_product_id (NOT paItemId)
    const { data: paOrders } = await supabase
      .from("pa_orders")
      .select("location_id, order_date, items")
      .gte("order_date", cutoffISO(PA_ORDER_LOOKBACK_DAYS));
    const paOrderIdx = new Map<string, any>(); // key: location_id::pa_product_id
    for (const o of (paOrders || [])) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const sku = it?.pa_product_id;
        if (!o.location_id || sku == null) continue;
        const k = `${o.location_id}::${String(sku)}`;
        const prior = paOrderIdx.get(k);
        if (!prior || (o.order_date && o.order_date > (prior._order_date ?? ''))) {
          // Only carry a pack_size when PA order has explicit pack info.
          // The previous `1 ${it.unit}` fallback synthesized a degenerate
          // "1 case × 1 case" structure that duplicated pa_catalog proposals.
          const rawPack = it.pack_size ?? it.pack ?? null;
          paOrderIdx.set(k, {
            pack_size: rawPack,
            unit_price: it.price ?? null,
            description: it.name ?? null,
            pa_product_id: sku,
            item_code: it.item_code,
            master_product_code: it.master_product_code,
            _order_date: o.order_date,
          });
        }
      }
    }

    // Invoices — for ENRICHMENT only (option a: no source-of-truth use yet).
    // vendor_invoice_items has no pack_size column; we attach the raw
    // product_name + unit + qty + price so the deferred reports become
    // human-triageable. Two indexes:
    //   invoiceByPair    — keyed location_id::matched_template_id (most recent)
    //   invoiceByTemplate — keyed matched_template_id (most recent across any
    //                       location), used when only template_id is known
    //                       (needs_vendor_mapping rows).
    const { data: invLines } = await supabase
      .from("vendor_invoice_items")
      .select("matched_template_id, item_number, product_name, unit, quantity, unit_price, total_price, vendor_invoices!inner(location_id, invoice_date, invoice_number, vendor_name)")
      .not("matched_template_id", "is", null)
      .gte("vendor_invoices.invoice_date", cutoffISO(INVOICE_LOOKBACK_DAYS));
    const enrichByPair = new Map<string, any>();      // location_id::template_id
    const enrichByTemplate = new Map<string, any>();  // template_id
    for (const il of (invLines || [])) {
      const inv = (il as any).vendor_invoices;
      if (!inv?.location_id || !il.matched_template_id) continue;
      const enrichment = {
        most_recent_invoice_date: inv.invoice_date,
        most_recent_invoice_number: inv.invoice_number,
        most_recent_vendor_name: inv.vendor_name,
        invoice_product_name: il.product_name,
        invoice_unit: il.unit,
        invoice_quantity: il.quantity,
        invoice_unit_price: il.unit_price,
      };
      const pk = `${inv.location_id}::${il.matched_template_id}`;
      const pPrior = enrichByPair.get(pk);
      if (!pPrior || (inv.invoice_date && inv.invoice_date > (pPrior.most_recent_invoice_date ?? ''))) {
        enrichByPair.set(pk, enrichment);
      }
      const tPrior = enrichByTemplate.get(il.matched_template_id);
      if (!tPrior || (inv.invoice_date && inv.invoice_date > (tPrior.most_recent_invoice_date ?? ''))) {
        enrichByTemplate.set(il.matched_template_id, enrichment);
      }
    }


    // ── Resolution loop ──
    const candidates: ProposalCandidate[] = [];
    const ledgerRows: { location_id: string; brand_template_id: string; pack_structure_key: string; vendor: string; vendor_item_id: string; source: string }[] = [];

    const buckets = {
      eligible_templates: eligibleTemplateIds.size,
      templates_with_mapping: 0,
      templates_with_locations: 0,
      pairs_evaluated: 0,
      pairs_with_source_evidence: 0,
      pairs_resolved_pfg_bid: 0,
      pairs_resolved_pfg_order: 0,
      pairs_resolved_pa_catalog: 0,
      pairs_resolved_pa_order: 0,
      pairs_resolved_invoice_only: 0,
      pairs_with_override_applied: 0,
      proposals_emitted: 0,
      ledger_rows_emitted: 0,
    };
    const reports = {
      needs_vendor_mapping: [] as { template_id: string; template_name: string; locations: string[] }[],
      needs_source_evidence: [] as { template_id: string; template_name: string; location_id: string; vendor: string; vendor_item_id: string }[],
      needs_deduplication: [] as { template_id: string; template_name: string; mappings: { vendor: string; vendor_item_id: string }[]; locations: string[] }[],
      parse_failures: [] as { template_id: string; template_name: string; location_id: string; source: string; pack_string: string }[],
    };


    const templatesById = new Map<string, any>((templates || []).map((t: any) => [t.id, t]));

    for (const [templateId, locSet] of locationsByTemplate.entries()) {
      buckets.templates_with_locations++;
      const tpl = templatesById.get(templateId);
      let maps = mappingsByTemplate.get(templateId);

      if (!maps || maps.length === 0) {
        reports.needs_vendor_mapping.push({
          template_id: templateId,
          template_name: tpl?.product_name ?? '(unknown)',
          locations: Array.from(locSet),
        });
        continue;
      }
      buckets.templates_with_mapping++;

      if (maps.length > 1) {
        // Equivalence collapse: if every mapping resolves to the SAME
        // pack_structure_key (outer_qty × inner_qty × common_unit) after
        // override application — using a source-probe fallback when override
        // fields are partial — treat them as duplicate SKUs for the same
        // physical pack and emit one proposal using the first mapping as
        // representative. If any mapping is unresolvable, or if the resolved
        // structures differ, keep the hard skip into needs_deduplication
        // (Jordan's "DIFF vendor = NEW BRAND ITEM" rule).
        const structureKeys: (string | null)[] = maps.map((m) => {
          const ov = m.override;
          if (ov.outer_qty != null && ov.inner_qty != null && ov.inner_type != null) {
            return structureKey({
              outer_qty: ov.outer_qty,
              inner_qty: ov.inner_qty,
              common_unit: ov.inner_type,
            });
          }
          for (const locationId of locSet) {
            let probed: ReturnType<typeof parsePackString> = null;
            if (m.vendor === 'pfg') {
              const bid = pfgBidIdx.get(`${locationId}::${m.vendor_item_id}`);
              if (bid?.pack_size) probed = parsePackString(bid.pack_size);
              if (!probed) {
                const ord = pfgOrderIdx.get(`${locationId}::${m.vendor_item_id}`);
                if (ord?.packSize) probed = parsePackString(ord.packSize);
              }
            } else if (m.vendor === 'pa') {
              const cat = paCatalogIdx.get(`${locationId}::${m.vendor_item_id}`);
              if (cat?.pack_size) probed = parsePackString(cat.pack_size);
              if (!probed) {
                const ord = paOrderIdx.get(`${locationId}::${m.vendor_item_id}`);
                if (ord?.pack_size) probed = parsePackString(ord.pack_size);
              }
            }
            if (probed) {
              return structureKey({
                outer_qty: ov.outer_qty ?? probed.outer_qty,
                inner_qty: ov.inner_qty ?? probed.inner_qty,
                common_unit: ov.inner_type ?? probed.common_unit,
              });
            }
          }
          return null;
        });

        const unresolvable = structureKeys.some((k) => k === null);
        const distinct = new Set(structureKeys.filter((k): k is string => k !== null));
        if (unresolvable || distinct.size > 1) {
          reports.needs_deduplication.push({
            template_id: templateId,
            template_name: tpl?.product_name ?? '(unknown)',
            mappings: maps.map(m => ({ vendor: m.vendor, vendor_item_id: m.vendor_item_id })),
            locations: Array.from(locSet),
          });
          continue;
        }
        maps = [maps[0]];
      }


      for (const locationId of locSet) {
        buckets.pairs_evaluated++;

        // Collect every source row for this (template, location), across all mappings.
        const resolved: ResolvedSource[] = [];

        for (const m of maps) {
          if (m.vendor === 'pfg') {
            const bid = pfgBidIdx.get(`${locationId}::${m.vendor_item_id}`);
            if (bid?.pack_size) {
              const parsed = parsePackString(bid.pack_size);
              if (parsed) {
                resolved.push({
                  source: 'pfg_bid', vendor: 'pfg', vendor_item_id: m.vendor_item_id,
                  parsed: { outer_qty: parsed.outer_qty, outer_type: 'case', inner_qty: parsed.inner_qty, inner_type: parsed.inner_type, common_unit: parsed.common_unit },
                  cost_per_case: bid.unit_price ?? null, raw_pack_string: bid.pack_size,
                  observed_at: bid.last_seen_at ?? null, label: formatPackLabel(parsed),

                });
              } else {
                reports.parse_failures.push({ template_id: templateId, template_name: tpl?.product_name ?? '(unknown)', location_id: locationId, source: 'pfg_bid', pack_string: bid.pack_size });
              }
            }
            const ord = pfgOrderIdx.get(`${locationId}::${m.vendor_item_id}`);
            if (ord?.packSize) {
              const parsed = parsePackString(ord.packSize);
              if (parsed) {
                resolved.push({
                  source: 'pfg_order', vendor: 'pfg', vendor_item_id: m.vendor_item_id,
                  parsed: { outer_qty: parsed.outer_qty, outer_type: 'case', inner_qty: parsed.inner_qty, inner_type: parsed.inner_type, common_unit: parsed.common_unit },
                  cost_per_case: ord.price ?? null, raw_pack_string: ord.packSize,
                  observed_at: ord._order_date ?? null, label: formatPackLabel(parsed),
                });
              } else {
                reports.parse_failures.push({ template_id: templateId, template_name: tpl?.product_name ?? '(unknown)', location_id: locationId, source: 'pfg_order', pack_string: ord.packSize });
              }
            }
          } else if (m.vendor === 'pa') {
            const cat = paCatalogIdx.get(`${locationId}::${m.vendor_item_id}`);
            if (cat?.pack_size) {
              const parsed = parsePackString(cat.pack_size);
              if (parsed) {
                resolved.push({
                  source: 'pa_catalog', vendor: 'pa', vendor_item_id: m.vendor_item_id,
                  parsed: { outer_qty: parsed.outer_qty, outer_type: 'case', inner_qty: parsed.inner_qty, inner_type: parsed.inner_type, common_unit: parsed.common_unit },
                  cost_per_case: cat.unit_price ?? null, raw_pack_string: cat.pack_size,
                  observed_at: cat.last_seen_at ?? null, label: formatPackLabel(parsed),
                });
              } else {
                reports.parse_failures.push({ template_id: templateId, template_name: tpl?.product_name ?? '(unknown)', location_id: locationId, source: 'pa_catalog', pack_string: cat.pack_size });
              }
            }
            const ord = paOrderIdx.get(`${locationId}::${m.vendor_item_id}`);
            if (ord?.pack_size) {
              const parsed = parsePackString(ord.pack_size);
              if (parsed) {
                resolved.push({
                  source: 'pa_order', vendor: 'pa', vendor_item_id: m.vendor_item_id,
                  parsed: { outer_qty: parsed.outer_qty, outer_type: 'case', inner_qty: parsed.inner_qty, inner_type: parsed.inner_type, common_unit: parsed.common_unit },
                  cost_per_case: ord.unit_price ?? null, raw_pack_string: ord.pack_size,
                  observed_at: ord._order_date ?? null, label: formatPackLabel(parsed),
                });
              }
            }
          }
          // Heimark / other → no vendor source pipeline yet (option a).
        }

        // NOTE: invoice augmentation removed this session — vendor_invoice_items
        // has no pack_size column. See needs_source_evidence enrichment below.



        // Hard-whitelist: no source evidence → skip, log, do NOT emit a proposal.
        if (resolved.length === 0) {
          for (const m of maps) {
            reports.needs_source_evidence.push({
              template_id: templateId, template_name: tpl?.product_name ?? '(unknown)',
              location_id: locationId, vendor: m.vendor, vendor_item_id: m.vendor_item_id,
            });
          }
          continue;
        }
        buckets.pairs_with_source_evidence++;

        // Bucket counts (first-class source wins)
        const primary = resolved[0];
        switch (primary.source) {
          case 'pfg_bid': buckets.pairs_resolved_pfg_bid++; break;
          case 'pfg_order': buckets.pairs_resolved_pfg_order++; break;
          case 'pa_catalog': buckets.pairs_resolved_pa_catalog++; break;
          case 'pa_order': buckets.pairs_resolved_pa_order++; break;
          case 'invoice': buckets.pairs_resolved_invoice_only++; break;
        }

        // Emit one candidate per distinct resolved source row.
        // Apply override (field-wise) on top of parsed pack.
        for (const r of resolved) {
          const mapping = maps.find(mm => mm.vendor_item_id === r.vendor_item_id && (mm.vendor === r.vendor || (mm.vendor === 'pa' && r.vendor === 'pa'))) ?? maps[0];
          const ov = mapping.override;
          const overrideApplied = ov.outer_qty != null || ov.outer_type != null || ov.inner_qty != null || ov.inner_type != null;
          if (overrideApplied) buckets.pairs_with_override_applied++;

          const final: ParsedPack = {
            outer_qty: ov.outer_qty ?? r.parsed.outer_qty,
            outer_type: ov.outer_type ?? r.parsed.outer_type,
            inner_qty: ov.inner_qty ?? r.parsed.inner_qty,
            inner_type: ov.inner_type ?? r.parsed.inner_type,
            common_unit: ov.inner_type ?? r.parsed.common_unit, // override inner_type also drives common_unit (semantic re-anchor)
          };
          // count_units_per_case MUST match CHECK constraint: outer_qty * COALESCE(inner_qty, 1)
          const cupc = final.outer_qty * (final.inner_qty || 1);
          const costPerCommon = r.cost_per_case != null && cupc > 0 ? Number(r.cost_per_case) / cupc : null;

          const sk = structureKey({ outer_qty: final.outer_qty, inner_qty: final.inner_qty, common_unit: final.common_unit });

          candidates.push({
            brand_template_id: templateId,
            vendor: r.vendor,
            vendor_item_id: r.vendor_item_id,
            outer_qty: final.outer_qty,
            outer_type: final.outer_type,
            inner_qty: final.inner_qty,
            inner_type: final.inner_type,
            common_unit: final.common_unit,
            count_units_per_case: cupc,
            cost_per_common_unit: costPerCommon,
            label: r.label ?? null,
            source: `vendor_sync:${r.vendor}:${r.source}`,
            source_evidence: {
              source: r.source,
              vendor: r.vendor,
              vendor_item_id: r.vendor_item_id,
              parsed_pack: r.parsed,
              pack_override_applied: overrideApplied,
              override_values: overrideApplied ? ov : null,
              final_pack: final,
              cost_basis: { cost_per_case: r.cost_per_case, raw_pack_string: r.raw_pack_string, observed_at: r.observed_at },
              // Flat aliases — BrandPackConfigApprovals.tsx reads these legacy field names.
              // Keep alongside the nested shape so both old UI and new audit consumers work.
              sku: r.vendor_item_id,
              packString: r.raw_pack_string,
              costPerCase: r.cost_per_case,
              territory: null,
            },
            location_id: locationId,
            pack_structure_key: sk,
          });

          ledgerRows.push({
            location_id: locationId,
            brand_template_id: templateId,
            pack_structure_key: sk,
            vendor: r.vendor,
            vendor_item_id: r.vendor_item_id,
            source: r.source,
          });
        }
      }
    }

    // ── Dedup proposal candidates by full key (template + vendor + SKU + cupc + common_unit) ──
    const proposalByKey = new Map<string, ProposalCandidate>();
    for (const c of candidates) {
      const k = candidateDedupKey(c);
      if (!proposalByKey.has(k)) proposalByKey.set(k, c);
    }
    buckets.proposals_emitted = proposalByKey.size;
    buckets.ledger_rows_emitted = ledgerRows.length;

    // ── Classify against existing brand_pack_configs (proposed + approved) ──
    // Three indexes:
    //   existingByFullKey      — keyed (template, vendor, vendor_item_id, cupc, common_unit)
    //                            for exact-match dedup against proposed+approved.
    //   approvedBySkuKey       — keyed (template, vendor, vendor_item_id) → approved row.
    //                            "Human-approved wins" short-circuit.
    //   existingByLegacyKey    — keyed (template, cupc, common_unit). Only populated for
    //                            rows whose source_evidence has NO vendor_item_id (legacy
    //                            human-approved configs from before vendor sync existed).
    const { data: existing } = await supabase
      .from("brand_pack_configs")
      .select("id, brand_template_id, outer_qty, inner_qty, common_unit, count_units_per_case, cost_per_common_unit, status, source_evidence");
    const existingByFullKey = new Map<string, any>();
    const existingByLegacyKey = new Map<string, any>();
    const approvedBySkuKey = new Map<string, any>();
    for (const r of (existing || [])) {
      if (r.status === 'archived') continue;
      const ev = (r.source_evidence ?? {}) as any;
      const sku = ev.vendor_item_id ?? ev.sku ?? null;
      const vendor = ev.vendor ?? null;
      const cupc = Number(r.count_units_per_case ?? (Number(r.outer_qty) * Number(r.inner_qty || 1)));
      const legacyK = legacyDedupKey({ brand_template_id: r.brand_template_id, count_units_per_case: cupc, common_unit: r.common_unit });
      if (sku && vendor) {
        const fullK = candidateDedupKey({ brand_template_id: r.brand_template_id, vendor: String(vendor), vendor_item_id: String(sku), count_units_per_case: cupc, common_unit: r.common_unit });
        existingByFullKey.set(fullK, r);
        if (r.status === 'approved') {
          const skuK = approvedSkuKey({ brand_template_id: r.brand_template_id, vendor: String(vendor), vendor_item_id: String(sku) });
          // First-seen wins; if multiple approved rows exist for the same SKU
          // (shouldn't happen — UNIQUE index prevents it — but defensive),
          // we leave the first one in place.
          if (!approvedBySkuKey.has(skuK)) approvedBySkuKey.set(skuK, r);
        }
      } else {
        // legacy — no SKU stamp yet. Eligible for SKU-stamping fallback.
        if (!existingByLegacyKey.has(legacyK)) existingByLegacyKey.set(legacyK, r);
      }
    }

    let bucketsNew = 0, bucketsMatched = 0, bucketsLegacyStamp = 0;
    let bucketsApprovedSkipped = 0, bucketsApprovedDiffStructure = 0, bucketsCostUpdateOnApproved = 0;
    const legacyStampPlan: { existing_id: string; vendor: string; vendor_item_id: string; template_id: string; legacy_key: string }[] = [];
    const costUpdatePlan: { approved_id: string; old_cost: number | null; new_cost: number | null; sku_key: string; template_id: string }[] = [];
    for (const c of proposalByKey.values()) {
      const fullK = candidateDedupKey(c);
      if (existingByFullKey.has(fullK)) { bucketsMatched++; continue; }

      // NEW: approved-SKU short-circuit. If an approved config already exists
      // for this (template, vendor, sku), do NOT emit a proposal — period.
      // Same structure → update cost in place if vendor price differs.
      // Different structure → still skip (human-approved structure wins;
      // a real pack change requires manual re-approval).
      const skuK = approvedSkuKey(c);
      const approvedRow = approvedBySkuKey.get(skuK);
      if (approvedRow) {
        if (structuresMatch(approvedRow, c)) {
          bucketsApprovedSkipped++;
          const oldCost = approvedRow.cost_per_common_unit == null ? null : Number(approvedRow.cost_per_common_unit);
          const newCost = c.cost_per_common_unit == null ? null : Number(c.cost_per_common_unit);
          if (newCost != null && Number.isFinite(newCost) && newCost > 0 && (oldCost == null || Math.abs(oldCost - newCost) > 0.0001)) {
            bucketsCostUpdateOnApproved++;
            costUpdatePlan.push({ approved_id: approvedRow.id, old_cost: oldCost, new_cost: newCost, sku_key: skuK, template_id: c.brand_template_id });
          }
        } else {
          bucketsApprovedDiffStructure++;
        }
        continue;
      }

      const legacyK = legacyDedupKey(c);
      const legacyRow = existingByLegacyKey.get(legacyK);
      if (legacyRow) {
        bucketsLegacyStamp++;
        legacyStampPlan.push({
          existing_id: legacyRow.id,
          vendor: c.vendor,
          vendor_item_id: c.vendor_item_id,
          template_id: c.brand_template_id,
          legacy_key: legacyK,
        });
        continue;
      }
      bucketsNew++;
    }

    // ── Enrich deferred reports with most-recent invoice context ──
    const enrichedNeedsSourceEvidence = reports.needs_source_evidence.map(r => {
      const pairHit = enrichByPair.get(`${r.location_id}::${r.template_id}`);
      const tplHit = enrichByTemplate.get(r.template_id);
      const hit = pairHit ?? tplHit ?? null;
      return {
        ...r,
        ...(hit ?? {}),
        invoice_match_scope: pairHit ? 'location' : (tplHit ? 'template_any_location' : null),
        no_invoice_history: !hit,
      };
    }).sort((a, b) => (a.template_name ?? '').localeCompare(b.template_name ?? ''));

    const enrichedNeedsVendorMapping = reports.needs_vendor_mapping.map(r => {
      const hit = enrichByTemplate.get(r.template_id) ?? null;
      return {
        ...r,
        ...(hit ?? {}),
        no_invoice_history: !hit,
      };
    }).sort((a, b) => (a.template_name ?? '').localeCompare(b.template_name ?? ''));

    // ── DRY-RUN: return everything, write nothing ──
    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        run_id: runId,
        checkpoint: "A",
        buckets: {
          ...buckets,
          proposals_new_vs_existing: {
            new: bucketsNew,
            matched_existing: bucketsMatched,
            legacy_sku_stamp: bucketsLegacyStamp,
            approved_sku_short_circuit_same_structure: bucketsApprovedSkipped,
            approved_sku_short_circuit_diff_structure: bucketsApprovedDiffStructure,
            approved_cost_update_planned: bucketsCostUpdateOnApproved,
          },
        },
        legacy_sku_stamp_plan: legacyStampPlan,
        cost_update_plan: costUpdatePlan,

        reports: {
          needs_vendor_mapping_count: enrichedNeedsVendorMapping.length,
          needs_source_evidence_count: enrichedNeedsSourceEvidence.length,
          needs_source_evidence_no_invoice_count: enrichedNeedsSourceEvidence.filter(r => r.no_invoice_history).length,
          needs_deduplication_count: reports.needs_deduplication.length,
          parse_failures_count: reports.parse_failures.length,
          // Full lists (sorted by template name) — paste-able for triage.
          needs_vendor_mapping: enrichedNeedsVendorMapping,
          needs_source_evidence: enrichedNeedsSourceEvidence,
          needs_deduplication: reports.needs_deduplication.sort((a, b) => (a.template_name ?? '').localeCompare(b.template_name ?? '')),
          parse_failures: reports.parse_failures.sort((a, b) => (a.template_name ?? '').localeCompare(b.template_name ?? '')),
        },

        sample_proposals: Array.from(proposalByKey.values()),
        sample_ledger_rows: ledgerRows.slice(0, 10),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // ── LIVE run: insert new proposals, stamp SKU onto legacy approved rows,
    //              short-circuit when an approved config already exists for the same SKU. ──
    let inserted = 0, skipped = 0, legacyStamped = 0, legacyStampErrors = 0;
    let approvedShortCircuited = 0, approvedCostUpdated = 0, approvedCostUpdateErrors = 0;
    for (const c of proposalByKey.values()) {
      const fullK = candidateDedupKey(c);
      if (existingByFullKey.has(fullK)) { skipped++; continue; }

      // NEW: approved-SKU short-circuit — never emit a proposal when an
      // approved config already exists for (template, vendor, sku).
      // Same structure → update cost in place. Different structure → skip
      // silently (human-approved structure wins).
      const skuK = approvedSkuKey(c);
      const approvedRow = approvedBySkuKey.get(skuK);
      if (approvedRow) {
        approvedShortCircuited++;
        if (structuresMatch(approvedRow, c)) {
          const oldCost = approvedRow.cost_per_common_unit == null ? null : Number(approvedRow.cost_per_common_unit);
          const newCost = c.cost_per_common_unit == null ? null : Number(c.cost_per_common_unit);
          if (newCost != null && Number.isFinite(newCost) && newCost > 0 && (oldCost == null || Math.abs(oldCost - newCost) > 0.0001)) {
            const { error: costErr } = await supabase
              .from("brand_pack_configs")
              .update({
                cost_per_common_unit: newCost,
                source_evidence: {
                  ...(approvedRow.source_evidence ?? {}),
                  last_cost_refresh: {
                    at: new Date().toISOString(),
                    by: 'pack-config-seeder',
                    old_cost: oldCost,
                    new_cost: newCost,
                    source: c.source,
                  },
                },
              })
              .eq("id", approvedRow.id);
            if (costErr) { approvedCostUpdateErrors++; } else { approvedCostUpdated++; }
          }
        }
        continue;
      }

      const legacyK = legacyDedupKey(c);
      const legacyRow = existingByLegacyKey.get(legacyK);
      if (legacyRow) {
        // Stamp candidate's SKU onto the existing approved row's source_evidence,
        // preserving any prior fields. Does NOT change pack/cost/status.
        const merged = {
          ...(legacyRow.source_evidence ?? {}),
          vendor: c.vendor,
          vendor_item_id: c.vendor_item_id,
          sku: c.vendor_item_id,
          sku_stamped_at: new Date().toISOString(),
          sku_stamped_by: 'pack-config-seeder',
        };
        const { error: upErr } = await supabase
          .from("brand_pack_configs")
          .update({ source_evidence: merged })
          .eq("id", legacyRow.id);
        if (upErr) { legacyStampErrors++; } else { legacyStamped++; }
        // Prevent the same legacy row from being stamped twice in one run.
        existingByLegacyKey.delete(legacyK);
        continue;
      }
      const { error: insErr } = await supabase.from("brand_pack_configs").insert({
        brand_template_id: c.brand_template_id,
        outer_qty: c.outer_qty,
        outer_type: c.outer_type,
        inner_qty: c.inner_qty,
        inner_type: c.inner_type,
        common_unit: c.common_unit,
        count_units_per_case: c.count_units_per_case,
        cost_per_common_unit: c.cost_per_common_unit,
        label: c.label,
        source: c.source,
        source_evidence: c.source_evidence,
        status: 'proposed',
      });
      if (insErr) { skipped++; continue; }
      inserted++;
    }


    // Ledger upsert — table schema uses single `vendor_source` column.
    // CHECK constraint restricts to: pfg_bid | pfg_order | pa_catalog |
    // pa_order | invoice (i.e. the source enum, vendor is implied by it).
    // Unique on (location_id, brand_template_id, pack_structure_key).
    let ledgerUpserted = 0;
    let ledgerErrors = 0;
    let ledgerLastError: string | null = null;
    if (ledgerRows.length > 0) {
      // Dedupe in-memory: same (location, template, pack_structure_key) may be
      // pushed twice (pfg_bid + pfg_order). Postgres rejects upserts whose
      // INSERT side contains duplicate conflict-target rows.
      const dedup = new Map<string, typeof ledgerRows[number]>();
      for (const r of ledgerRows) {
        const k = `${r.location_id}::${r.brand_template_id}::${r.pack_structure_key}`;
        if (!dedup.has(k)) dedup.set(k, r); // first-seen wins (pfg_bid before pfg_order)
      }
      const deduped = Array.from(dedup.values());
      const chunk = 500;
      const nowISO = new Date().toISOString();
      for (let i = 0; i < deduped.length; i += chunk) {
        const batch = deduped.slice(i, i + chunk).map(r => ({
          location_id: r.location_id,
          brand_template_id: r.brand_template_id,
          pack_structure_key: r.pack_structure_key,
          vendor_source: r.source,
          last_seen_at: nowISO,
        }));
        const { error: ledErr } = await supabase
          .from("location_pack_seen_ledger")
          .upsert(batch, { onConflict: "location_id,brand_template_id,pack_structure_key" });
        if (ledErr) {
          console.error("ledger upsert error", ledErr);
          ledgerErrors += batch.length;
          ledgerLastError = ledErr.message;
        } else {
          ledgerUpserted += batch.length;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true, dry_run: false, run_id: runId,
      inserted_proposals: inserted, skipped_proposals: skipped,
      legacy_sku_stamped: legacyStamped, legacy_sku_stamp_errors: legacyStampErrors,
      approved_sku_short_circuited: approvedShortCircuited,
      approved_cost_updated: approvedCostUpdated,
      approved_cost_update_errors: approvedCostUpdateErrors,
      ledger_rows_upserted: ledgerUpserted,
      ledger_rows_failed: ledgerErrors,
      ledger_last_error: ledgerLastError,
      buckets,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("pack-config-seeder error", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
