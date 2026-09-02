// Targeted price chase — powers the "N unpriced · Sync" button on the item list.
//
// Chases prices for a SMALL explicit set of items (or every unpriced item at one
// location) using the same shared chain as the nightly run: master list → recent
// orders → recent invoices. Never walks the whole catalog, never deactivates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chasePrices, CHASE_SELECT } from "../_shared/vendorPriceChase.ts";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_ITEMS = 300;

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

    let query = supabase
      .from("inventory_items")
      .select(CHASE_SELECT)
      .eq("location_id", locationId)
      .eq("is_active", true)
      .limit(MAX_ITEMS);

    if (itemIds.length > 0) {
      query = query.in("id", itemIds.slice(0, MAX_ITEMS));
    } else {
      // Default: only the unpriced ones — that's the whole point of the button.
      query = query.or("unpriced_since.not.is.null,cost_per_unit.is.null");
    }

    const { data: items, error } = await query;
    if (error) throw error;

    const summary = await chasePrices(supabase, locationId, (items || []) as any[]);

    return new Response(
      JSON.stringify({
        location_id: locationId,
        chased: (items || []).length,
        priced: summary.priced,
        still_unpriced: summary.unpriced,
        ship_ins: summary.shipIns,
        discontinued: summary.discontinued,
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
