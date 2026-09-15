// Targeted price chase — powers the "N unpriced · Sync" button on the item list.
//
// Chases prices for a SMALL explicit set of items (or every unpriced item at one
// location) using the same shared chain as the nightly run: master list → recent
// orders → recent invoices. Never walks the whole catalog, never deactivates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chasePrices, CHASE_SELECT } from "../_shared/vendorPriceChase.ts";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";
import { isExcludedLocation } from "../_shared/inventoryGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_ITEMS = 300;
// Sweep mode covers a whole freshly-deployed catalog, which is far bigger than the
// handful the "N unpriced" button ever touches.
const MAX_ITEMS_SWEEP = 5000;
const PAGE_SIZE = 1000;
// Deploy-time window, wider than the nightly 14 days: a brand-new store needs a
// complete starting picture, not an incremental refresh.
const SWEEP_WINDOW_DAYS = 30;


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = await requireAuthorizedCaller(req, corsHeaders, { minRole: "manager" });
  if (denied) return denied;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const locationId: string | null = body?.locationId ?? null;
    const itemIds: string[] = Array.isArray(body?.itemIds) ? body.itemIds.map(String) : [];
    const refreshMasters: boolean = body?.refreshMasters === true;
    // PHASE 2 ACTIVATION SWEEP (deploy only): price every deployed item, active or not,
    // and switch on the ones that came back with a real price.
    const activate: boolean = body?.activate === true;
    const includeInactive: boolean = body?.includeInactive === true || activate;


    if (!locationId) {
      return new Response(JSON.stringify({ error: "locationId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hard, named exclusion (sandbox stores) — independent of inventory_enabled.
    if (isExcludedLocation(locationId)) {
      return new Response(
        JSON.stringify({ skipped: "excluded_location", location_id: locationId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Optional: pull a fresh bid guide first so the chase sees today's prices.
    if (refreshMasters) {
      try {
        await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/pfg-service?action=scrape_bid_all_locations`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ action: "scrape_bid_all_locations", locationId }),
          },
        );
      } catch (e) {
        console.warn("[vendor-price-chase] master refresh failed, chasing cached data:", e);
      }
    }

    const cap = activate || includeInactive ? MAX_ITEMS_SWEEP : MAX_ITEMS;

    const buildQuery = (from: number, to: number) => {
      let q = supabase
        .from("inventory_items")
        .select(CHASE_SELECT)
        .eq("location_id", locationId)
        .order("id", { ascending: true })
        .range(from, to);

      // Sweep mode must see the inactive items Phase 1 just deployed.
      if (!includeInactive) q = q.eq("is_active", true);

      if (itemIds.length > 0) {
        q = q.in("id", itemIds.slice(0, cap));
      } else if (!activate) {
        // Default: only the unpriced ones — that's the whole point of the button.
        // Sweep mode intentionally skips this filter: it prices the whole deploy.
        q = q.or("unpriced_since.not.is.null,cost_per_unit.is.null");
      }
      return q;
    };

    // FAIL-SOFT paging: a failed page is logged and we chase what we already
    // have, instead of throwing away the pages that loaded fine.
    const items: any[] = [];
    const pageErrors: string[] = [];
    for (let from = 0; from < cap; from += PAGE_SIZE) {
      const to = Math.min(from + PAGE_SIZE, cap) - 1;
      try {
        const { data, error } = await buildQuery(from, to);
        if (error) {
          pageErrors.push(`rows ${from}-${to}: ${error.message}`);
          break;
        }
        items.push(...(data || []));
        if (!data || data.length < to - from + 1) break;
      } catch (e) {
        pageErrors.push(`rows ${from}-${to}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    if (pageErrors.length > 0) {
      console.warn("[vendor-price-chase] partial item load:", pageErrors.join(" | "));
    }

    const summary = await chasePrices(supabase, locationId, items as any[], {
      ...(activate ? { activateOnHit: true, windowDays: SWEEP_WINDOW_DAYS } : {}),
    });

    return new Response(
      JSON.stringify({
        location_id: locationId,
        mode: activate ? "activation_sweep" : "targeted_chase",
        chased: items.length,
        priced: summary.priced,
        still_unpriced: summary.unpriced,
        ship_ins: summary.shipIns,
        discontinued: summary.discontinued,
        activated_house_made: summary.activatedHouseMade,
        results: summary.results,
      }),

      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[vendor-price-chase]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
