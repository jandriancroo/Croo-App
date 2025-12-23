import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeJwtPayload(token: string): any {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = parts[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

async function authenticateQuBeyond(
  username: string,
  password: string,
): Promise<{ tokenGw: string; qbLocationId: string } | null> {
  console.log(`[sync-day-sales] Authenticating with QuBeyond for ${username}...`);

  try {
    const authResponse = await fetch("https://api.qubeyond.com/api/v2.0/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        rememberMe: false,
        siteCode: null,
      }),
    });

    if (!authResponse.ok) {
      console.error("[sync-day-sales] Auth failed:", authResponse.status);
      return null;
    }

    const authData = await authResponse.json();
    const tokenApi = authData?.token;
    if (!tokenApi) {
      console.error("[sync-day-sales] No token in auth response");
      return null;
    }

    const gwResponse = await fetch("https://api.qubeyond.com/api/v2.0/auth/gw-token", {
      method: "GET",
      headers: { Authorization: tokenApi },
    });

    if (!gwResponse.ok) {
      console.error("[sync-day-sales] GW token fetch failed:", gwResponse.status);
      return null;
    }

    const gwData = await gwResponse.json();
    const tokenGw = gwData?.accessToken;
    if (!tokenGw) {
      console.error("[sync-day-sales] No accessToken in GW response");
      return null;
    }

    const decoded = decodeJwtPayload(tokenGw);
    const qbLocationId = String(decoded?.loc || decoded?.locations?.[0] || "");

    console.log(`[sync-day-sales] Auth OK, qbLocationId=${qbLocationId}`);
    return { tokenGw, qbLocationId };
  } catch (error) {
    console.error("[sync-day-sales] Authentication error:", error);
    return null;
  }
}

async function fetchHourlySales(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string,
): Promise<{ hour: string; sales: number; checksCount: number }[]> {
  const requestPayload = {
    fields: [
      { fieldName: "hour" },
      { fieldName: "checksCount" },
      { fieldName: "netSales" },
      { fieldName: "averageCheck" },
      { fieldName: "discount" },
      { fieldName: "serviceCharge" },
      { fieldName: "tax" },
      { fieldName: "netSalesPercentage" },
    ],
    filters: {
      date: { from: null, to: null, values: [dateStr], type: "custom" },
      singleLocation: parseInt(qbLocationId),
      location: { operationalUnits: [parseInt(qbLocationId)] },
    },
    params: {
      sectionId: "main",
      pageNumber: 1,
      pageSize: 25,
      totalRecords: null,
      sort: null,
      showTotals: true,
    },
  };

  const response = await fetch(
    "https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: tokenGw,
        Origin: "https://admin.qubeyond.com",
        Referer: "https://admin.qubeyond.com/",
      },
      body: JSON.stringify(requestPayload),
    },
  );

  if (!response.ok) {
    console.error(`[sync-day-sales] Hourly fetch failed (${response.status}) for ${dateStr}`);
    return [];
  }

  const data = await response.json();
  const hourlyData: { hour: string; sales: number; checksCount: number }[] = [];

  const convertTo24Hour = (time12h: string): string => {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12h;
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    if (period === "AM") {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }
    return `${hours.toString().padStart(2, "0")}:${minutes}`;
  };

  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      const rawHour = item.hour || "";
      const hour24 = convertTo24Hour(rawHour);
      const sales = parseFloat(String(item.netSales || "0").replace(/[$,]/g, "")) || 0;
      const checksCount = parseInt(String(item.checksCount || "0").replace(/,/g, "")) || 0;
      if (rawHour) hourlyData.push({ hour: hour24, sales, checksCount });
    }
  }

  return hourlyData;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { locationId, date } = await req.json();

    if (!locationId || !date) {
      return new Response(JSON.stringify({ error: "Missing locationId or date" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Authorize caller for this location
    const { data: hasAccess, error: accessError } = await supabase.rpc(
      "has_location_access",
      { _user_id: user.id, _location_id: locationId },
    );

    if (accessError) {
      console.error("[sync-day-sales] access check error:", accessError);
      return new Response(JSON.stringify({ error: "Access check failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: integration, error: intError } = await supabase
      .from("location_integrations")
      .select("credentials")
      .eq("location_id", locationId)
      .eq("integration_type", "qubeyond")
      .eq("is_active", true)
      .maybeSingle();

    if (intError || !integration) {
      console.error("[sync-day-sales] Integration not found:", intError);
      return new Response(JSON.stringify({ error: "Integration not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credentials = integration.credentials as { username?: string; password?: string };
    if (!credentials?.username || !credentials?.password) {
      return new Response(JSON.stringify({ error: "Missing integration credentials" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: locSettings } = await supabase
      .from("location_settings")
      .select("pizza_sales_percentage, average_pizza_price")
      .eq("location_id", locationId)
      .maybeSingle();

    const pizzaSalesPercentage = locSettings?.pizza_sales_percentage ?? 80;
    const averagePizzaPrice = locSettings?.average_pizza_price ?? 10.5;

    const auth = await authenticateQuBeyond(credentials.username, credentials.password);
    if (!auth) {
      return new Response(JSON.stringify({ error: "QuBeyond authentication failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hourly = await fetchHourlySales(auth.tokenGw, date, auth.qbLocationId);
    const netSales = hourly.reduce((sum, h) => sum + h.sales, 0);
    const guestCount = hourly.reduce((sum, h) => sum + h.checksCount, 0);
    // Round to nearest half pizza
    const rawPizzaCount = (netSales * (pizzaSalesPercentage / 100)) / averagePizzaPrice;
    const pizzaCount = Math.round(rawPizzaCount * 2) / 2;

    const formattedHourly = [] as Array<{ hour: string; sales: number; checksCount: number }>;
    for (let h = 0; h < 24; h++) {
      const hourStr = `${h.toString().padStart(2, "0")}:00`;
      const hourData = hourly.find((hd) => hd.hour === hourStr);
      formattedHourly.push({
        hour: hourStr,
        sales: hourData?.sales || 0,
        checksCount: hourData?.checksCount || 0,
      });
    }

    if (netSales <= 0) {
      console.log(`[sync-day-sales] ${locationId} ${date}: netSales=0, not overwriting cache`);
      return new Response(
        JSON.stringify({ status: "no_sales", locationId, date, netSales, guestCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const avgTicket = guestCount > 0 ? netSales / guestCount : null;

    const { error: upsertError } = await supabase
      .from("sales_cache")
      .upsert(
        {
          location_id: locationId,
          sale_date: date,
          net_sales: netSales,
          guest_count: guestCount,
          pizza_count: pizzaCount,
          avg_ticket: avgTicket,
          hourly_data: formattedHourly,
          validation_status: "valid",
          validation_attempts: 1,
          flagged_no_sales: false,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "location_id,sale_date" },
      );

    if (upsertError) {
      console.error("[sync-day-sales] Upsert failed:", upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[sync-day-sales] Upsert OK: ${locationId} ${date} $${netSales.toFixed(2)} (${guestCount} guests)`);

    return new Response(
      JSON.stringify({
        status: "updated",
        locationId,
        date,
        netSales,
        guestCount,
        pizzaCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[sync-day-sales] Error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
