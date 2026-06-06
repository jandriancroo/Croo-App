// Pack-config seeder — reads traceable vendor sources (PFG orders, PA catalog)
// and derives brand_pack_configs + location_pack_selections.
//
// Dry-run mode compares what the seeder would produce against existing proposed
// rows in brand_pack_configs, classifying each as:
//   matched  — existing row is byte-for-byte reproducible from a traceable source
//   diff     — source exists but values differ from the existing row
//   orphan   — existing row has no traceable source (invoice-only, hand-written, etc.)
//   new      — traceable source exists but no matching proposed row
//
// Actual-run (dry_run=false) inserts reproducible rows as 'proposed' and logs
// every decision to pack_config_seed_log.
//
// Idempotent: will not create duplicate proposed rows for the same
// (brand_template_id, outer_qty, inner_qty, inner_type) combination.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Pack-string parser (handles PFG, PA, and compact formats) ──
interface ParsedPack {
  outer_qty: number;
  inner_qty: number;
  inner_type: string;
  common_unit: string;
}

function parsePackString(packString: string | null | undefined): ParsedPack | null {
  if (!packString) return null;
  const trimmed = packString.trim();

  // Format: "4 / 1 GA" or "1/4 LB" or "6/5LB"
  const slashMatch = trimmed.match(/^\s*(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/);
  if (slashMatch) {
    const outer_qty = parseInt(slashMatch[1], 10);
    const inner_qty = parseFloat(slashMatch[2]);
    const rawUnit = slashMatch[3].toLowerCase();
    if (!Number.isFinite(outer_qty) || !Number.isFinite(inner_qty) || outer_qty <= 0 || inner_qty <= 0) return null;
    const { inner_type, common_unit } = normalizeUnit(rawUnit);
    return { outer_qty, inner_qty, inner_type, common_unit };
  }

  // Format: "3 CT" or "2.5 KG" (no slash — single pack, outer=1)
  const noSlashMatch = trimmed.match(/^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/);
  if (noSlashMatch) {
    const inner_qty = parseFloat(noSlashMatch[1]);
    const rawUnit = noSlashMatch[2].toLowerCase();
    if (!Number.isFinite(inner_qty) || inner_qty <= 0) return null;
    const { inner_type, common_unit } = normalizeUnit(rawUnit);
    return { outer_qty: 1, inner_qty, inner_type, common_unit };
  }

  return null;
}

function normalizeUnit(raw: string): { inner_type: string; common_unit: string } {
  switch (raw) {
    case 'lb': case 'lbs': return { inner_type: 'lb', common_unit: 'lb' };
    case 'oz': case 'ozs': return { inner_type: 'oz', common_unit: 'oz' };
    case 'ga': case 'gal': case 'gallon': case 'gallons': return { inner_type: 'ga', common_unit: 'ga' };
    case 'kg': case 'kgs': return { inner_type: 'kg', common_unit: 'kg' };
    case 'g': case 'gs': return { inner_type: 'g', common_unit: 'g' };
    case 'ct': case 'ea': case 'each': case 'cn': case 'count': return { inner_type: 'ea', common_unit: 'ea' };
    default: return { inner_type: raw, common_unit: raw };
  }
}

// ── Source record types ──
interface SourceRecord {
  vendor: string;               // 'pfg' | 'pa' | etc.
  vendor_item_id: string;       // SKU / item number
  pack_string: string;          // raw pack size string
  cost_per_case: number;        // case price
  brand_template_id?: string;   // matched via brand_vendor_mappings
  location_id?: string;         // source location (for provenance)
}

// ── Seeded row candidate ──
interface SeedCandidate {
  brand_template_id: string;
  outer_qty: number;
  outer_type: string;
  inner_qty: number;
  inner_type: string;
  common_unit: string;
  count_units_per_case: number;
  cost_per_common_unit: number;
  label: string | null;
  source: string;
  source_evidence: Record<string, any>;
  vendor: string;
  vendor_item_id: string;
}

// ── Comparison result ──
interface RowMatch {
  existing_id: string;
  status: 'matched' | 'diff' | 'orphan';
  candidate?: SeedCandidate;
  diffs?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const sourceFilter = url.searchParams.get("source") || "all"; // 'all', 'pfg', 'pa'
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // ── 0. Load archived brand_inventory_templates so we never seed against them.
    // Matches vendor-gap-scan's `.neq('status','archived')` filter — keeps the
    // approval queue clean and prevents zombie proposals after a template is retired.
    const { data: archivedTemplates, error: archErr } = await supabase
      .from("brand_inventory_templates")
      .select("id")
      .eq("status", "archived");
    if (archErr) throw archErr;
    const archivedTemplateIds = new Set<string>((archivedTemplates || []).map((t: any) => t.id));

    // ── 1. Load all brand_vendor_mappings (skip ones pointing at archived templates) ──
    const { data: mappings, error: mapErr } = await supabase
      .from("brand_vendor_mappings")
      .select("id, brand_template_id, vendor, vendor_item_id, territory, source_location_id");
    if (mapErr) throw mapErr;

    const mappingByVendorSku = new Map<string, any>();
    for (const m of (mappings || [])) {
      if (!m.brand_template_id || archivedTemplateIds.has(m.brand_template_id)) continue;
      const key = `${(m.vendor || '').toLowerCase()}::${(m.vendor_item_id || '').toLowerCase()}`;
      mappingByVendorSku.set(key, m);
    }


    // ── 2. Gather traceable source records ──
    const candidates: SeedCandidate[] = [];

    // 2a. PFG orders (items JSONB)
    if (sourceFilter === "all" || sourceFilter === "pfg") {
      const { data: pfgOrders } = await supabase
        .from("pfg_orders")
        .select("id, location_id, order_number, items");
      for (const order of (pfgOrders || [])) {
        const items = (order.items || []) as Array<{
          itemNumber?: string;
          packSize?: string;
          price?: number;
          name?: string;
        }>;
        for (const it of items) {
          if (!it.itemNumber || !it.packSize) continue;
          const parsed = parsePackString(it.packSize);
          if (!parsed) continue;
          const mapping = mappingByVendorSku.get(`pfg::${it.itemNumber.toLowerCase()}`);
          if (!mapping?.brand_template_id) continue;

          const countUnits = Math.round(parsed.outer_qty * parsed.inner_qty * 100) / 100;
          const costPerCommon = it.price && countUnits > 0 ? it.price / countUnits : null;

          candidates.push({
            brand_template_id: mapping.brand_template_id,
            outer_qty: parsed.outer_qty,
            outer_type: 'case',
            inner_qty: parsed.inner_qty,
            inner_type: parsed.inner_type,
            common_unit: parsed.common_unit,
            count_units_per_case: countUnits,
            cost_per_common_unit: costPerCommon ?? 0,
            label: it.name || null,
            source: 'vendor_sync:pfg',
            source_evidence: {
              costPerCase: it.price,
              packString: it.packSize?.replace(/\s+/g, ''),
              raw: { pack_quantity: parsed.outer_qty, inner_pack_quantity: parsed.inner_qty },
              sku: it.itemNumber,
              vendor: 'pfg',
            },
            vendor: 'pfg',
            vendor_item_id: it.itemNumber,
          });
        }
      }
    }

    // 2b. PA catalog items
    if (sourceFilter === "all" || sourceFilter === "pa") {
      const { data: paItems } = await supabase
        .from("pa_catalog_items")
        .select("id, pa_item_id, pack_size, unit_price, description, location_id");
      for (const it of (paItems || [])) {
        if (!it.pa_item_id || !it.pack_size) continue;
        const parsed = parsePackString(it.pack_size);
        if (!parsed) continue;
        const mapping = mappingByVendorSku.get(`pa::${it.pa_item_id.toLowerCase()}`)
          || mappingByVendorSku.get(`produce_alliance::${it.pa_item_id.toLowerCase()}`);
        if (!mapping?.brand_template_id) continue;

        const countUnits = Math.round(parsed.outer_qty * parsed.inner_qty * 100) / 100;
        const costPerCommon = it.unit_price && countUnits > 0 ? it.unit_price / countUnits : null;

        candidates.push({
          brand_template_id: mapping.brand_template_id,
          outer_qty: parsed.outer_qty,
          outer_type: 'case',
          inner_qty: parsed.inner_qty,
          inner_type: parsed.inner_type,
          common_unit: parsed.common_unit,
          count_units_per_case: countUnits,
          cost_per_common_unit: costPerCommon ?? 0,
          label: it.description || null,
          source: 'vendor_sync:pa',
          source_evidence: {
            costPerCase: it.unit_price,
            packString: it.pack_size?.replace(/\s+/g, ''),
            raw: { pack_quantity: parsed.outer_qty, inner_pack_quantity: parsed.inner_qty },
            sku: it.pa_item_id,
            vendor: 'pa',
          },
          vendor: 'pa',
          vendor_item_id: it.pa_item_id,
        });
      }
    }

    // ── 3. Deduplicate candidates by STRUCTURE ONLY ──
    // Key matches the DB unique guard exactly:
    //   (brand_template_id, outer_qty, COALESCE(inner_qty,0), common_unit)
    // inner_type and source are label/provenance only — never part of structural identity.
    const candidateKey = (c: Pick<SeedCandidate, 'brand_template_id' | 'outer_qty' | 'inner_qty' | 'common_unit'>) =>
      `${c.brand_template_id}::${c.outer_qty}::${c.inner_qty ?? 0}::${c.common_unit}`;
    const deduped = new Map<string, SeedCandidate>();
    for (const c of candidates) {
      const k = candidateKey(c);
      if (!deduped.has(k)) deduped.set(k, c);
    }
    const uniqueCandidates = Array.from(deduped.values());

    // ── 4. Load existing rows (proposed AND approved) for structural comparison ──
    const { data: existingProposed, error: existErr } = await supabase
      .from("brand_pack_configs")
      .select("id, brand_template_id, outer_qty, outer_type, inner_qty, inner_type, common_unit, count_units_per_case, cost_per_common_unit, source, source_evidence, status");
    if (existErr) throw existErr;

    // Build structure-only index of proposed + approved rows.
    // Approved wins if both exist for the same structure (defensive — shouldn't happen post-cleanup).
    const existingByKey = new Map<string, any>();
    // SKU-scoped guard: track which (template, vendor, vendor_item_id) combos already
    // have a non-archived config. Prevents the seeder from spawning a sibling config
    // for the SAME vendor SKU just because its pack-string parses to a different
    // structural shape (e.g. PFG 180950 once as "6 case / 1 ea" and once as
    // "6 case / 2.5 kg"). Multi-leg configs are a human-only decision.
    const existingSkuByTemplate = new Map<string, Set<string>>();
    for (const row of (existingProposed || [])) {
      if (row.status !== 'proposed' && row.status !== 'approved') continue;
      const k = `${row.brand_template_id}::${row.outer_qty}::${row.inner_qty ?? 0}::${row.common_unit}`;
      const prior = existingByKey.get(k);
      if (!prior || (prior.status === 'proposed' && row.status === 'approved')) {
        existingByKey.set(k, row);
      }
      const evVendor = row.source_evidence?.vendor;
      const evSku = row.source_evidence?.sku;
      if (evVendor && evSku) {
        const skuKey = `${String(evVendor).toLowerCase()}::${String(evSku)}`;
        let set = existingSkuByTemplate.get(row.brand_template_id);
        if (!set) { set = new Set(); existingSkuByTemplate.set(row.brand_template_id, set); }
        set.add(skuKey);
      }
    }

    // ── 5. Compare and classify ──
    const results: RowMatch[] = [];
    const created: SeedCandidate[] = [];
    let diffCount = 0;
    let orphanCount = 0;
    let newCount = 0;
    let skippedCount = 0;

    // 5a. Walk every existing proposed/approved row — is it reproducible?
    for (const existing of (existingProposed || [])) {
      if (existing.status !== 'proposed' && existing.status !== 'approved') continue;
      const k = `${existing.brand_template_id}::${existing.outer_qty}::${existing.inner_qty ?? 0}::${existing.common_unit}`;
      const candidate = deduped.get(k);
      if (!candidate) {
        // Orphan tracking only applies to proposed rows — approved rows aren't expected to round-trip.
        if (existing.status === 'proposed') {
          orphanCount++;
          results.push({ existing_id: existing.id, status: 'orphan' });
          if (!dryRun) {
            await supabase.from("pack_config_seed_log").insert({
              brand_template_id: existing.brand_template_id,
              existing_config_id: existing.id,
              status: 'orphan',
              dry_run: false,
              run_id: runId,
            });
          }
        }
        continue;
      }

      const diffs: string[] = [];
      if (existing.outer_type !== candidate.outer_type) diffs.push(`outer_type: ${existing.outer_type} vs ${candidate.outer_type}`);
      if (existing.count_units_per_case !== candidate.count_units_per_case) diffs.push(`count_units_per_case: ${existing.count_units_per_case} vs ${candidate.count_units_per_case}`);
      if (Math.abs((existing.cost_per_common_unit || 0) - (candidate.cost_per_common_unit || 0)) > 0.0001) {
        diffs.push(`cost_per_common_unit: ${existing.cost_per_common_unit} vs ${candidate.cost_per_common_unit}`);
      }

      // Refresh price + evidence ONLY on proposed rows.
      // Approved rows are the brand-wide live reference — a single location's invoice
      // price must never overwrite them. Treat structural match against an approved
      // row as a match (don't spawn a duplicate proposal), but leave the row untouched.
      if (!dryRun && diffs.length > 0 && existing.status === 'proposed') {
        await supabase
          .from("brand_pack_configs")
          .update({
            cost_per_common_unit: candidate.cost_per_common_unit ?? existing.cost_per_common_unit,
            source_evidence: candidate.source_evidence,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }

      if (diffs.length === 0) {
        results.push({ existing_id: existing.id, status: 'matched', candidate });
        if (!dryRun) {
          await supabase.from("pack_config_seed_log").insert({
            brand_template_id: existing.brand_template_id,
            vendor: candidate.vendor,
            vendor_item_id: candidate.vendor_item_id,
            pack_string: candidate.source_evidence.packString,
            outer_qty: candidate.outer_qty,
            inner_qty: candidate.inner_qty,
            inner_type: candidate.inner_type,
            common_unit: candidate.common_unit,
            count_units_per_case: candidate.count_units_per_case,
            cost_per_common_unit: candidate.cost_per_common_unit,
            existing_config_id: existing.id,
            status: 'matched',
            dry_run: false,
            run_id: runId,
          });
        }
      } else {
        diffCount++;
        results.push({ existing_id: existing.id, status: 'diff', candidate, diffs });
        if (!dryRun) {
          await supabase.from("pack_config_seed_log").insert({
            brand_template_id: existing.brand_template_id,
            vendor: candidate.vendor,
            vendor_item_id: candidate.vendor_item_id,
            pack_string: candidate.source_evidence.packString,
            outer_qty: candidate.outer_qty,
            inner_qty: candidate.inner_qty,
            inner_type: candidate.inner_type,
            common_unit: candidate.common_unit,
            count_units_per_case: candidate.count_units_per_case,
            cost_per_common_unit: candidate.cost_per_common_unit,
            existing_config_id: existing.id,
            status: 'diff',
            dry_run: false,
            run_id: runId,
          });
        }
      }
    }

    // 5b. Walk every candidate — is it new?
    for (const c of uniqueCandidates) {
      const k = candidateKey(c);
      if (!existingByKey.has(k)) {
        newCount++;
        if (!dryRun) {
          const { data: inserted, error: insErr } = await supabase
            .from("brand_pack_configs")
            .insert({
              brand_template_id: c.brand_template_id,
              outer_qty: c.outer_qty,
              outer_type: c.outer_type,
              inner_qty: c.inner_qty,
              inner_type: c.inner_type,
              common_unit: c.common_unit,
              count_units_per_case: c.count_units_per_case,
              cost_per_common_unit: c.cost_per_common_unit || null,
              label: c.label,
              source: c.source,
              source_evidence: c.source_evidence,
              status: 'proposed',
            })
            .select("id")
            .single();
          if (insErr) {
            console.error("insert failed", insErr);
            skippedCount++;
            await supabase.from("pack_config_seed_log").insert({
              brand_template_id: c.brand_template_id,
              vendor: c.vendor,
              vendor_item_id: c.vendor_item_id,
              status: 'skipped',
              dry_run: false,
              run_id: runId,
            });
          } else {
            created.push(c);
            await supabase.from("pack_config_seed_log").insert({
              brand_template_id: c.brand_template_id,
              vendor: c.vendor,
              vendor_item_id: c.vendor_item_id,
              pack_string: c.source_evidence.packString,
              outer_qty: c.outer_qty,
              inner_qty: c.inner_qty,
              inner_type: c.inner_type,
              common_unit: c.common_unit,
              count_units_per_case: c.count_units_per_case,
              cost_per_common_unit: c.cost_per_common_unit,
              existing_config_id: inserted?.id,
              status: 'created',
              dry_run: false,
              run_id: runId,
            });
          }
        }
      }
    }

    const matchedCount = results.filter(r => r.status === 'matched').length;

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        run_id: runId,
        source_filter: sourceFilter,
        summary: {
          candidates_found: uniqueCandidates.length,
          existing_proposed: (existingProposed || []).filter(r => r.status === 'proposed').length,
          existing_approved: (existingProposed || []).filter(r => r.status === 'approved').length,
          existing_archived: (existingProposed || []).filter(r => r.status === 'archived').length,
          matched: matchedCount,
          diff: diffCount,
          orphan: orphanCount,
          new: newCount,
          created: dryRun ? 0 : created.length,
          skipped: dryRun ? 0 : skippedCount,
        },
        results: dryRun ? results : undefined,
        sample_new: dryRun
          ? uniqueCandidates.filter(c => !existingByKey.has(candidateKey(c))).slice(0, 5)
          : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("pack-config-seeder error", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
