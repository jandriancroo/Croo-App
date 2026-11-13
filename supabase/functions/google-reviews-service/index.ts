// Google reviews for stores that are not on Ovation (Places API New, 5 most
// recent reviews). The app never calls this function: it reads
// get_location_google_reviews() from the database.
//
// Actions
//   refresh     service role / CRON_SECRET only (pg_cron hourly, 8 AM-10 PM
//               ET). Two steps per store: rating + count
//               first; reviews only when the count changed, none are stored,
//               or the last full pull is > 7 days old. Overwrites the row.
//               Outside those hours it skips unless { force: true }.
//   find_place  signed-in admin only. Text search to look up a store's place
//               ID. Returns candidates; writes nothing.
//
// GOOGLE_PLACES_API_KEY is read from the edge secrets only. It is never
// returned, stored or logged. When it is missing, every action returns a quiet
// { skipped: "no_key" } so the cron job does not fill the logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { authorizeCaller, requireInternalCaller } from "../_shared/callerAuth.ts";
import {
import { keepLiveLocationIds } from "../_shared/locationLive.ts";
  DETAILS_FIELD_MASK,
  LIGHT_FIELD_MASK,
  PLACES_BASE,
  isRefreshHourEt,
  easternHour,
  needsFullPull,
  SEARCH_FIELD_MASK,
  describePlacesError,
  isValidPlaceId,
  normalizePlace,
  normalizeSearch,
} from "./places.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BODY = 2000;
type Body = { action?: string; locationId?: string; force?: boolean; query?: string };
type Row = { location_id: string; place_id: string; user_rating_count: number | null; reviews: unknown; last_full_fetch_at: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function placesGet(placeId: string, key: string, mask: string) {
  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask },
  });
  const payload = await res.json().catch(() => null);
  return res.ok ? { ok: true as const, payload } : { ok: false as const, error: describePlacesError(res.status, payload) };
}

async function refresh(body: Body, key: string) {
  const now = new Date();
  // Hourly, 8 AM-10 PM ET only; the cron SQL guard does the same check first.
  if (body?.force !== true && !isRefreshHourEt(easternHour(now))) {
    return json({ ok: true, skipped: "outside_hours" });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let q = admin
    .from("location_google_reviews")
    .select("location_id, place_id, user_rating_count, reviews, last_full_fetch_at")
    .eq("active", true);
  if (body?.locationId) {
    if (!UUID.test(String(body.locationId))) return json({ error: "Bad locationId" }, 400);
    q = q.eq("location_id", body.locationId);
  }
  const { data: allRows, error } = await q;
  if (error) {
    console.error("[google-reviews] list failed", error.code ?? "");
    return json({ error: "list_failed" }, 500);
  }
  // Skip switched-off (inactive) locations.
  const liveIds = new Set(await keepLiveLocationIds(admin, ((allRows ?? []) as Row[]).map((r) => r.location_id)));
  const rows = ((allRows ?? []) as Row[]).filter((r) => liveIds.has(r.location_id));

  let light = 0;
  let full = 0;
  let failed = 0;
  for (const row of (rows ?? []) as Row[]) {
    let update: Record<string, unknown>;
    if (!isValidPlaceId(row.place_id)) {
      update = { last_error: "bad_place_id" };
    } else {
      try {
        // Step 1: score + count only (cheap).
        const step1 = await placesGet(row.place_id, key, LIGHT_FIELD_MASK);
        if (!step1.ok) {
          update = { last_error: step1.error };
        } else {
          const lite = normalizePlace(step1.payload);
          const pullReviews = needsFullPull({
            storedCount: row.user_rating_count,
            storedReviews: row.reviews,
            lastFullFetchAt: row.last_full_fetch_at,
            newCount: lite.user_rating_count,
            now,
          });
          if (!pullReviews) {
            light++;
            update = { rating: lite.rating, user_rating_count: lite.user_rating_count, fetched_at: now.toISOString(), last_error: null };
          } else {
            // Step 2: reviews too. Overwrite in place; no history is kept.
            const step2 = await placesGet(row.place_id, key, DETAILS_FIELD_MASK);
            if (!step2.ok) {
              update = { rating: lite.rating, user_rating_count: lite.user_rating_count, fetched_at: now.toISOString(), last_error: step2.error };
            } else {
              full++;
              update = { ...normalizePlace(step2.payload), fetched_at: now.toISOString(), last_full_fetch_at: now.toISOString(), last_error: null };
            }
          }
        }
      } catch {
        update = { last_error: "places_network_error" };
      }
    }
    const { error: upErr } = await admin.from("location_google_reviews").update(update).eq("location_id", row.location_id);
    if (upErr || update.last_error) {
      failed++;
      console.warn("[google-reviews] refresh failed", row.location_id, update.last_error ?? upErr?.code ?? "");
    }
  }
  return json({ ok: true, countOnly: light, withReviews: full, failed });
}

async function findPlace(body: Body, key: string) {
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (query.length < 3) return json({ error: "Enter a store name and city" }, 400);
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": SEARCH_FIELD_MASK },
    body: JSON.stringify({ textQuery: query, pageSize: 5 }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = describePlacesError(res.status, payload);
    console.warn("[google-reviews] find_place failed", msg);
    return json({ error: msg }, 502);
  }
  return json({ ok: true, candidates: normalizeSearch(payload) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (raw.length > MAX_BODY) return json({ error: "Too large" }, 413);
  let body: Body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const action = new URL(req.url).searchParams.get("action") || body?.action || "";

  if (action === "refresh") {
    const denied = requireInternalCaller(req, corsHeaders);
    if (denied) return denied;
  } else if (action === "find_place") {
    const auth = await authorizeCaller(req, corsHeaders, { minRole: "admin" });
    if ("response" in auth) return auth.response;
    // A signed-in admin token is required; the cron/service path is for refresh only.
    if (auth.caller.kind !== "user") return json({ error: "Forbidden" }, 403);
  } else {
    return json({ error: "Unknown action" }, 400);
  }

  const key = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
  if (!key) return json({ ok: true, skipped: "no_key" });

  try {
    return action === "refresh" ? await refresh(body, key) : await findPlace(body, key);
  } catch {
    console.error("[google-reviews] unexpected error", action);
    return json({ error: "internal_error" }, 500);
  }
});
