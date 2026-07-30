import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

async function authenticateV4(): Promise<string | null> {
  const clientId = Deno.env.get("QU_USERNAME");
  const clientSecret = Deno.env.get("QU_PASSWORD");
  if (!clientId || !clientSecret) return null;

  const formData = new FormData();
  formData.append("grant_type", "client_credentials");
  formData.append("client_id", clientId);
  formData.append("client_secret", clientSecret);

  const response = await fetch(
    "https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token",
    { method: "POST", body: formData }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.access_token || null;
}

function getV4Headers(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "x-integration": Deno.env.get("QU_INTEGRATION_USER_ID") || "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  {
    const denied = await requireAuthorizedCaller(req, corsHeaders);
    if (denied) return denied;
  }

  try {
    const { locationId, search, daysBack, scope } = await req.json();
    const singleLocation = scope === "location";
    if (!locationId) {
      return new Response(JSON.stringify({ error: "locationId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve brand: prefer locations.brand_id, fall back to location → organization → brand
    const { data: loc } = await supabase
      .from("locations")
      .select("brand_id, organization_id")
      .eq("id", locationId)
      .single();

    let brandId: string | null = (loc as any)?.brand_id ?? null;
    if (!brandId && loc?.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("brand_id")
        .eq("id", loc.organization_id)
        .single();
      brandId = org?.brand_id || null;
    }


    // Collect ALL QU location IDs across the brand
    let quLocationIds: number[] = [];

    if (brandId && !singleLocation) {
      // Get all locations in this brand via organizations
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id")
        .eq("brand_id", brandId);

      if (orgs && orgs.length > 0) {
        const orgIds = orgs.map((o: any) => o.id);
        const { data: locs } = await supabase
          .from("locations")
          .select("id")
          .in("organization_id", orgIds);

        if (locs && locs.length > 0) {
          const locIds = locs.map((l: any) => l.id);
          const { data: integrations } = await supabase
            .from("location_integrations")
            .select("credentials")
            .in("location_id", locIds)
            .eq("integration_type", "qubeyond")
            .eq("is_active", true);

          if (integrations) {
            for (const integ of integrations) {
              const creds = integ.credentials as any;
              const qId = parseInt(creds?.location_id);
              if (qId && !quLocationIds.includes(qId)) {
                quLocationIds.push(qId);
              }
            }
          }
        }
      }
    }

    // Fallback: if brand resolution failed, use just the single location
    if (quLocationIds.length === 0) {
      const { data: integration } = await supabase
        .from("location_integrations")
        .select("credentials")
        .eq("location_id", locationId)
        .eq("integration_type", "qubeyond")
        .eq("is_active", true)
        .single();

      if (!integration) {
        return new Response(
          JSON.stringify({ error: "No QU integration for this location" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const creds = integration.credentials as any;
      const qId = parseInt(creds?.location_id);
      if (!qId) {
        return new Response(
          JSON.stringify({ error: "No QU location_id in credentials" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      quLocationIds = [qId];
    }

    const token = await authenticateV4();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "QU authentication failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build date range — default 90 days back
    const days = Math.min(daysBack || 90, 180);
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days);
    const toStr = today.toISOString().split("T")[0];
    const fromStr = fromDate.toISOString().split("T")[0];

    console.log(`[pos-search] Fetching product mix ${fromStr} to ${toStr} for QU locations: [${quLocationIds.join(", ")}]`);

    const response = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/product-mix/sections/main",
      {
        method: "POST",
        headers: getV4Headers(token),
        body: JSON.stringify({
          fields: [
            { fieldName: "itemGroup" },
            { fieldName: "itemName" },
            { fieldName: "quantity" },
            { fieldName: "netSales" },
          ],
          filters: {
            date: { from: fromStr, to: toStr, type: "custom" },
            location: { operationalUnits: quLocationIds },
          },
          params: {
            sectionId: "main",
            pageNumber: 1,
            pageSize: 500,
            totalRecords: null,
            sort: [{ field: "netSales", dir: "desc" }],
            showTotals: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[pos-search] QU API error: ${response.status} ${errorText.substring(0, 200)}`);
      const isFallbackable = response.status === 429 || response.status >= 500;
      return new Response(
        JSON.stringify({
          error: isFallbackable ? "RATE_LIMITED" : `QU API returned ${response.status}`,
          fallback: isFallbackable,
          items: [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const items: { name: string; category: string; quantity: number }[] = [];

    const processRow = (row: any, fallbackCategory?: string) => {
      const name = row.itemName || row.productName || row.name || "";
      if (!name || name === "Totals") return;
      const category =
        row.itemGroupName || row.itemGroup || row.categoryName || row.category || fallbackCategory || "";
      const quantity = parseFloat(String(row.quantity || "0").replace(/,/g, "")) || 0;
      items.push({ name, category, quantity });
    };

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item.items && Array.isArray(item.items)) {
          const groupName =
            item.itemGroupName || item.itemGroup || item.categoryName || item.category || "";
          for (const child of item.items) {
            processRow(child, groupName);
          }
        } else {
          processRow(item);
        }
      }
    }

    // If search term provided, filter
    let filtered = items;
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = items.filter(
        (i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
      );
    }

    // Deduplicate by name (aggregate quantity across stores)
    const deduped = new Map<string, { name: string; category: string; quantity: number }>();
    for (const item of filtered) {
      const existing = deduped.get(item.name);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        deduped.set(item.name, { ...item });
      }
    }

    const result = Array.from(deduped.values()).sort((a, b) => b.quantity - a.quantity);

    console.log(`[pos-search] Found ${items.length} total items across ${quLocationIds.length} stores, ${result.length} after filter/dedup`);

    return new Response(JSON.stringify({ items: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[pos-search] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
