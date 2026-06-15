import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORE_TIME_ZONE = "America/Los_Angeles";

function getLosAngelesToday(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

async function authenticateV4(): Promise<string | null> {
  const clientId = Deno.env.get("QU_USERNAME");
  const clientSecret = Deno.env.get("QU_PASSWORD");
  if (!clientId || !clientSecret) return null;

  const form = new FormData();
  form.append("grant_type", "client_credentials");
  form.append("client_id", clientId);
  form.append("client_secret", clientSecret);

  const res = await fetch(
    "https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token",
    { method: "POST", body: form },
  );
  if (!res.ok) return null;
  return (await res.json()).access_token || null;
}

function parseMoney(v: any): number {
  return parseFloat(String(v ?? "0").replace(/,/g, "")) || 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { location_id } = await req.json();
    if (!location_id) {
      return new Response(JSON.stringify({ error: "location_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authenticate the user via JWT claims (works with signing-keys auth).
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve QU store id from location_integrations
    const { data: integ } = await supabase
      .from("location_integrations")
      .select("credentials")
      .eq("location_id", location_id)
      .eq("integration_type", "qubeyond")
      .eq("is_active", true)
      .maybeSingle();

    const quStoreId = Number(integ?.credentials?.location_id);
    if (!quStoreId) {
      return new Response(JSON.stringify({
        kioskSales: 0, kioskCheckCount: 0, kioskAvgCheck: 0,
        otherAvgCheck: 0, avgCheckVariance: 0, hasKiosk: false,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const quToken = await authenticateV4();
    if (!quToken) {
      return new Response(JSON.stringify({ error: "QU auth failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = getLosAngelesToday();
    const checkRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "x-integration": Deno.env.get("QU_INTEGRATION_USER_ID") || "",
        },
        body: JSON.stringify({
          fields: [
            { fieldName: "checkNumber" },
            { fieldName: "orderChannelName" },
            { fieldName: "checkState" },
            { fieldName: "netSales" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [quStoreId] },
          },
          params: {
            sectionId: "main",
            pageNumber: 1,
            pageSize: 1000,
            sort: [{ field: "date", dir: "desc" }],
          },
        }),
      },
    );

    if (!checkRes.ok) {
      return new Response(JSON.stringify({ error: `QU API ${checkRes.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await checkRes.json();
    const items = (data.items || []).filter(
      (it: any) => it.checkNumber && it.checkNumber !== "Total",
    );

    let kioskSales = 0, kioskCount = 0;
    let otherSales = 0, otherCount = 0;
    const channelTally: Record<string, { count: number; sales: number }> = {};

    for (const it of items) {
      const rawChannel = String(it.orderChannelName || "(none)");
      const channel = rawChannel.toLowerCase();
      const net = parseMoney(it.netSales);
      const t = channelTally[rawChannel] ||= { count: 0, sales: 0 };
      t.count += 1; t.sales += net;
      if (channel.includes("kiosk")) {
        kioskSales += net;
        kioskCount += 1;
      } else {
        otherSales += net;
        otherCount += 1;
      }
    }

    const kioskAvg = kioskCount > 0 ? kioskSales / kioskCount : 0;
    const otherAvg = otherCount > 0 ? otherSales / otherCount : 0;
    const varianceDollars = kioskCount > 0 ? kioskAvg - otherAvg : 0;

    return new Response(JSON.stringify({
      kioskSales,
      kioskCheckCount: kioskCount,
      kioskAvgCheck: kioskAvg,
      otherAvgCheck: otherAvg,
      avgCheckVariance: varianceDollars,
      hasKiosk: kioskCount > 0,
      sampledChecks: items.length,
      channelBreakdown: channelTally,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
