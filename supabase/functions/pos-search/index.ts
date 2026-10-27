import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCaller } from "../_shared/callerAuth.ts";
import { DateTime } from "npm:luxon@3";

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

type PosItem = { name: string; category: string; quantity: number; itemMasterId?: string | number; onMenu?: boolean };
type MenuItem = { itemMasterId?: string | number; itemReportTitle?: string; configurationsTagsNames?: string | string[] };
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

async function fetchMenu(opUnitId: number, token: string): Promise<MenuItem[] | null> {
  const bases = [
    `https://gateway-api.qubeyond.com/api/v4/data/operations/${opUnitId}/inventory`,
    `https://admin.qubeyond.com/api/data/operations/${opUnitId}/inventory`,
  ];
  try {
    for (const base of bases) {
      let pageSize = 200;
      let pageCount = 1;
      const items: MenuItem[] = [];
      let tryNextUrl = false;
      for (let page = 1; page <= pageCount; page++) {
        const url = `${base}?page_number=${page}&page_size=${pageSize}&sort=reportTitle_asc`;
        const response = await fetch(url, { headers: getV4Headers(token) });
        console.log(`[pos-search] Menu GET ${url} HTTP ${response.status}`);
        if (!response.ok) {
          if ([400, 422].includes(response.status) && pageSize > 50) {
            pageSize = pageSize === 200 ? 100 : 50;
            page--;
            continue;
          }
          if ([401, 403, 404].includes(response.status) && base === bases[0]) {
            tryNextUrl = true;
            break;
          }
          return null;
        }
        const payload = await response.json();
        if (!Array.isArray(payload.data)) return null;
        items.push(...payload.data);
        const count = Number(payload.meta?.pageCount ?? 1);
        if (!Number.isInteger(count) || count < 0) return null;
        pageCount = count;
      }
      if (tryNextUrl) continue;
      console.log(`[pos-search] Menu worked ${base}; ${items.length} items`);
      return items;
    }
  } catch {
    console.warn(`[pos-search] Menu unavailable for operation ${opUnitId}`);
  }
  return null;
}

async function fetchMenuSales(token: string, opUnitIds: number[], days: number): Promise<PosItem[]> {
  const today = DateTime.now().setZone("America/Los_Angeles");
  const items: PosItem[] = [];
  let page = 1;
  let totalRecords: number | null = null;
  do {
    const response = await fetch("https://gateway-api.qubeyond.com/api/v4/data/reports/product-mix/sections/main", {
      method: "POST",
      headers: getV4Headers(token),
      body: JSON.stringify({
        fields: [{ fieldName: "itemGroup" }, { fieldName: "itemName" }, { fieldName: "quantity" }, { fieldName: "netSales" }],
        filters: { date: { from: today.minus({ days }).toISODate(), to: today.toISODate(), type: "custom" }, location: { operationalUnits: opUnitIds } },
        params: { sectionId: "main", pageNumber: page, pageSize: 500, totalRecords, sort: [{ field: "netSales", dir: "desc" }], showTotals: true },
      }),
    });
    console.log(`[pos-search] Menu sales ${days}d page ${page} HTTP ${response.status}`);
    if (!response.ok) throw new Error("Product mix unavailable");
    const payload = await response.json();
    const rows = Array.isArray(payload.items) ? payload.items : [];
    const processRow = (row: any, fallbackCategory = "") => {
      const name = row.itemName || row.productName || row.name || "";
      if (!name || name === "Totals") return;
      items.push({ name, category: row.itemGroupName || row.itemGroup || row.categoryName || row.category || fallbackCategory,
        quantity: parseFloat(String(row.quantity || "0").replace(/,/g, "")) || 0 });
    };
    for (const row of rows) {
      if (Array.isArray(row.items)) {
        const category = row.itemGroupName || row.itemGroup || row.categoryName || row.category || "";
        for (const child of row.items) processRow(child, category);
      } else processRow(row);
    }
    const count = Number(payload.totalRecords ?? payload.meta?.recordCount);
    totalRecords = Number.isFinite(count) && count > 0 ? count : null;
    const pageCount = Number(payload.pageCount ?? payload.meta?.pageCount);
    if (Number.isFinite(pageCount) && pageCount > 0) {
      if (page >= pageCount) break;
    } else if (totalRecords === null || page * 500 >= totalRecords || rows.length === 0) break;
    page++;
  } while (true);
  return items;
}

function mergeMenuSales(menu: MenuItem[], sales: PosItem[]): PosItem[] {
  const entries = new Map<string, PosItem>();
  const names = new Map<string, PosItem>();
  for (const row of menu) {
    const name = row.itemReportTitle || "";
    if (!cleanName(name)) continue;
    const id = row.itemMasterId;
    const key = id !== undefined && id !== null && id !== "" ? `id:${id}` : `name:${cleanName(name)}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { name, category: Array.isArray(row.configurationsTagsNames) ? row.configurationsTagsNames.join(", ") : row.configurationsTagsNames || "",
        quantity: 0, onMenu: true, ...(key.startsWith("id:") ? { itemMasterId: id } : {}) };
      entries.set(key, entry);
    }
    names.set(cleanName(name), entry);
  }
  for (const row of sales) {
    const nameKey = cleanName(row.name);
    const existing = names.get(nameKey);
    if (existing) existing.quantity += row.quantity;
    else {
      const entry = { ...row, onMenu: false };
      entries.set(`name:${nameKey}`, entry);
      names.set(nameKey, entry);
    }
  }
  return Array.from(entries.values()).sort((a, b) => b.quantity - a.quantity);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await authorizeCaller(req, corsHeaders);
    if ("response" in auth) return auth.response;
    const { locationId, search, daysBack, scope, includeMenu } = await req.json();
    const singleLocation = scope === "location";
    if (typeof locationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)
      || (includeMenu !== undefined && typeof includeMenu !== "boolean")
      || (daysBack !== undefined && (typeof daysBack !== "number" || !Number.isFinite(daysBack) || daysBack < 0))
      || (search !== undefined && typeof search !== "string")
      || (scope !== undefined && typeof scope !== "string")) {
      return new Response(JSON.stringify({ error: "locationId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    if (auth.caller.kind === "user") {
      const { data: allowed, error } = await supabase.rpc("has_location_access", {
        _user_id: auth.caller.userId, _location_id: locationId,
      });
      if (error || allowed !== true) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    if (includeMenu === true) {
      const menus = await Promise.all(quLocationIds.map(id => fetchMenu(id, token)));
      const menu = menus.flatMap(items => items || []);
      const menuUnavailable = menus.some(items => items === null || items.length === 0)
        || !menu.some(item => cleanName(item.itemReportTitle || ""));
      let sales: PosItem[] = [];
      try {
        sales = await fetchMenuSales(token, quLocationIds, menuUnavailable ? 90 : 14);
      } catch {
        console.warn("[pos-search] Menu search sales unavailable");
      }
      let items = mergeMenuSales(menuUnavailable ? [] : menu, sales);
      if (typeof search === "string" && search.trim()) {
        const query = search.trim().toLowerCase();
        items = items.filter(item => item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query));
      }
      return new Response(JSON.stringify({ items, ...(menuUnavailable ? { menuUnavailable: true } : {}) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      console.error(`[pos-search] QU API error: ${response.status}`);
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
    console.error("[pos-search] Request failed");
    return new Response(
      JSON.stringify({ error: "POS search unavailable" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
