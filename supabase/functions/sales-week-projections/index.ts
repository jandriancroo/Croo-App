// sales-week-projections — POS-neutral week projection service.
//
// Works for every brand and every sales system. It reads the normalized daily
// sales history that each POS adapter already writes into sales_cache, then
// fills forward-looking daily projections for a requested week using the
// shared projection engine. No vendor-specific logic lives here.
//
// Actions:
//   seed_week      { locationId, weekStart? }  — one location, one week
//   seed_all_weeks { weekOffset? }             — every location with an active POS
//
// Guarantees: never writes actual sales, never overwrites a manager override,
// never replaces an existing first projection, never touches labor or inventory.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";
import {
  getLocationTimezone,
  seedWeekProjections,
  todayInTimezone,
  weekStartFor,
} from "../_shared/weekProjections.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Any integration that delivers sales into sales_cache.
const POS_INTEGRATION_TYPES = ["qubeyond", "clover", "aloha"];

interface Body {
  action: "seed_week" | "seed_all_weeks";
  locationId?: string;
  weekStart?: string;
  weekOffset?: number;
}

function addWeeks(dateStr: string, weeks: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + weeks * 7);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = await requireAuthorizedCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const body = (await req.json()) as Body;
    const action = body.action || "seed_week";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "seed_week") {
      if (!body.locationId) throw new Error("locationId required");
      const result = await seedWeekProjections(supabase, body.locationId, body.weekStart);
      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "seed_all_weeks") {
      const offset = Number.isFinite(body.weekOffset) ? Number(body.weekOffset) : 0;

      const { data: integrations, error } = await supabase
        .from("location_integrations")
        .select("location_id, integration_type")
        .in("integration_type", POS_INTEGRATION_TYPES)
        .eq("is_active", true);
      if (error) throw new Error(`POS location lookup failed: ${error.message}`);

      const locationIds = [...new Set((integrations ?? []).map((i: any) => i.location_id as string))];
      const results: any[] = [];

      for (const locationId of locationIds) {
        try {
          const tz = await getLocationTimezone(supabase, locationId);
          const weekStart = addWeeks(weekStartFor(todayInTimezone(tz)), offset);
          const result = await seedWeekProjections(supabase, locationId, weekStart, tz);
          results.push({
            locationId,
            weekStart: result.weekStart,
            seeded: result.days.filter((d) => d.action !== "skipped").length,
            skipped: result.days.filter((d) => d.action === "skipped").length,
          });
        } catch (e) {
          console.error(`[sales-week-projections] ${locationId} failed:`, e);
          results.push({ locationId, error: e instanceof Error ? e.message : String(e) });
        }
      }

      return new Response(
        JSON.stringify({ success: true, action, locations: results.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e) {
    console.error("[sales-week-projections] error", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
