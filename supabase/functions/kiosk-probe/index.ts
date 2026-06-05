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
  const reqBody0 = await req.clone().json().catch(() => ({} as any));
  const { quStoreId = 1223, date = "2026-06-05" } = reqBody0;
  const token = await auth();
  if (!token) return new Response("auth failed", { status: 502, headers: corsHeaders });

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "x-integration": Deno.env.get("QU_INTEGRATION_USER_ID") || "",
  };

  // Try field set passed in body, else a known-safe baseline
  const reqBody = await req.json().catch(() => ({} as any));
  const fields: string[] = reqBody.fields || [
    "checkNumber","orderChannelName","checkState","netSales",
    "orderTypeName","serviceTypeName","tenderName","stationName","terminalName","employeeName","tableNumber","guestCount",
  ];

  const body = {
    fields: fields.map((f) => ({ fieldName: f })),
    filters: {
      date: { from: date, to: date, type: "custom" },
      location: { operationalUnits: [Number(quStoreId)] },
    },
    params: {
      sectionId: "main",
      pageNumber: 1,
      pageSize: 50,
      sort: [{ field: "date", dir: "desc" }],
    },
  };

  const r = await fetch(
    "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
    { method: "POST", headers, body: JSON.stringify(body) },
  );
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  // Summarize: tally distinct values per field for items that look kiosk vs not
  const items = (data.items || []).filter((it: any) => it.checkNumber && it.checkNumber !== "Total");
  const summary: any = { totalItems: items.length, sampleKeys: items[0] ? Object.keys(items[0]) : [], byChannel: {} };
  for (const it of items) {
    const k = `${it.orderChannelName || "?"} | ${it.orderTypeName || it.serviceTypeName || "?"}`;
    summary.byChannel[k] = (summary.byChannel[k] || 0) + 1;
  }
  // Pick two interesting examples: an OLO + Dine In and an OLO + Carry Out and a plain In Store
  const find = (pred: (it: any) => boolean) => items.find(pred);
  const examples = {
    olo_dine_in: find((it: any) => /olo/i.test(it.orderChannelName || "") && /dine/i.test(it.orderTypeName || it.serviceTypeName || "")),
    olo_carry: find((it: any) => /olo/i.test(it.orderChannelName || "") && /carry|to.?go/i.test(it.orderTypeName || it.serviceTypeName || "")),
    in_store: find((it: any) => /in.?store/i.test(it.orderChannelName || "")),
  };

  return new Response(JSON.stringify({ status: r.status, summary, examples, firstItem: items[0], rawPreview: text.slice(0, 2000) }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
