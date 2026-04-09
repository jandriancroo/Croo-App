import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function getHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "x-integration": Deno.env.get("QU_INTEGRATION_USER_ID") || "",
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = await authenticateV4();
    if (!token) {
      return new Response(JSON.stringify({ error: "QU auth failed" }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const h = getHeaders(token);
    const results: Record<string, any> = {};
    const storeId = 5280;
    const today = new Date().toISOString().split('T')[0];

    // 1. Get check-detail with ALL fields to see what's available
    const checkRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "checkNumber" },
            { fieldName: "orderTypeName" },
            { fieldName: "orderChannelName" },
            { fieldName: "daypartName" },
            { fieldName: "date" },
            { fieldName: "checkState" },
            { fieldName: "itemSales" },
            { fieldName: "grossSales" },
            { fieldName: "netSales" },
            { fieldName: "taxes" },
            { fieldName: "tips" },
            { fieldName: "employee" },
            { fieldName: "terminalName" },
            { fieldName: "location" },
            { fieldName: "itemsSoldCount" },
            { fieldName: "description" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 50, sort: [{ field: "date", dir: "desc" }] },
        }),
      }
    );
    const checkData = await checkRes.json();
    results['check-detail-full'] = { status: checkRes.status, itemCount: checkData.items?.length, first5: checkData.items?.slice(0, 5) };

    // 2. Try the subreport for item-level detail on the first check
    if (checkData.items?.[0]?.checkNumberSubreport?.checkId) {
      const checkId = checkData.items[0].checkNumberSubreport.checkId;
      const subRes = await fetch(
        `https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main/subreport/checkNumber/${checkId}`,
        {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            fields: [
              { fieldName: "itemName" },
              { fieldName: "quantity" },
              { fieldName: "netSales" },
              { fieldName: "category" },
              { fieldName: "itemGroup" },
            ],
            params: { sectionId: "main", pageNumber: 1, pageSize: 50 },
          }),
        }
      );
      const subText = await subRes.text();
      let subData;
      try { subData = JSON.parse(subText); } catch { subData = subText.substring(0, 500); }
      results['subreport-items'] = { status: subRes.status, data: subData };
    }

    // 3. Try "item-detail" report — might give us per-order items directly
    const itemDetailRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/item-detail/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "itemName" },
            { fieldName: "checkNumber" },
            { fieldName: "quantity" },
            { fieldName: "netSales" },
            { fieldName: "orderTypeName" },
            { fieldName: "date" },
            { fieldName: "category" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 20, sort: [{ field: "date", dir: "desc" }] },
        }),
      }
    );
    if (itemDetailRes.ok) {
      const itemDetailData = await itemDetailRes.json();
      results['item-detail'] = { status: itemDetailRes.status, itemCount: itemDetailData.items?.length, first5: itemDetailData.items?.slice(0, 5) };
    } else {
      results['item-detail'] = { status: itemDetailRes.status };
    }

    // 4. Try "sales-detail" report
    const salesDetailRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/sales-detail/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "itemName" },
            { fieldName: "checkNumber" },
            { fieldName: "quantity" },
            { fieldName: "netSales" },
            { fieldName: "orderTypeName" },
            { fieldName: "date" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 20, sort: [{ field: "date", dir: "desc" }] },
        }),
      }
    );
    if (salesDetailRes.ok) {
      const salesDetailData = await salesDetailRes.json();
      results['sales-detail'] = { status: salesDetailRes.status, itemCount: salesDetailData.items?.length, first5: salesDetailData.items?.slice(0, 5) };
    } else {
      results['sales-detail'] = { status: salesDetailRes.status };
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
