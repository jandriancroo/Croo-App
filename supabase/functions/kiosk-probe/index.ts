import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function auth(): Promise<string | null> {
  const form = new FormData();
  form.append("grant_type", "client_credentials");
  form.append("client_id", Deno.env.get("QU_USERNAME")!);
  form.append("client_secret", Deno.env.get("QU_PASSWORD")!);
  const r = await fetch("https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token", { method: "POST", body: form });
  if (!r.ok) return null;
  return (await r.json()).access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = await auth();
  if (!token) return new Response("auth failed", { status: 502, headers: corsHeaders });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "x-integration": Deno.env.get("QU_INTEGRATION_USER_ID") || "",
  };

  // Throw the kitchen sink at check-detail/main and see which fields actually return values.
  // QU silently drops unknown fields, so we just keep the ones that come back populated.
  const candidateFields = [
    "checkNumber","orderChannelName","orderTypeName","checkState","netSales","employee",
    "terminalName","stationName","posDeviceName","posSourceName","posTerminalName","posTerminalType",
    "deviceName","deviceId","kioskName","selfOrderName","salesChannel","subChannel",
    "orderSource","orderSourceName","originName","originType","origin","sourceName",
    "aggregatorName","thirdPartyName","oloPlatform","oloOriginName","oloOrderType","oloSource",
    "orderingMode","orderMode","menuName","menuId","revenueCenterName","revenueCenterId",
    "tabletName","cashierName","serverName","operatorName","salesAgentName","entryMethod",
    "channelType","businessChannel","fulfillmentType","fulfillment","customerName","customerPhone",
  ];

  const body = {
    fields: candidateFields.map((f) => ({ fieldName: f })),
    filters: {
      date: { from: "2026-06-05", to: "2026-06-05", type: "custom" },
      location: { operationalUnits: [5280] },
    },
    params: { sectionId: "main", pageNumber: 1, pageSize: 50, sort: [{ field: "date", dir: "desc" }] },
  };

  const r = await fetch(
    "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
    { method: "POST", headers, body: JSON.stringify(body) },
  );
  const text = await r.text();
  const data = JSON.parse(text);
  const items = (data.items || []).filter((it: any) => it.checkNumber && it.checkNumber !== "Total");

  // Targets: the two kiosk checks Dave rang
  const kioskDinein = items.find((it: any) => it.checkNumber === "260605180448274");
  const kioskCarry  = items.find((it: any) => it.checkNumber === "260605180543452");
  // A real third-party OLO carry for contrast
  const oloRealCarry = items.find((it: any) =>
    it.orderChannelName === "OLO" &&
    it.orderTypeName === "Carry Out" &&
    it.checkNumber !== "260605180543452");
  const oloDelivery = items.find((it: any) => it.orderChannelName === "OLO" && it.orderTypeName === "Delivery");

  // Compute the union of keys that have values on any returned item
  const allKeys = new Set<string>();
  for (const it of items) for (const k of Object.keys(it)) if (it[k] !== "" && it[k] != null) allKeys.add(k);

  return new Response(JSON.stringify({
    populatedKeysAcrossAllItems: [...allKeys].sort(),
    kioskDinein,
    kioskCarry,
    oloRealCarry,
    oloDelivery,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
