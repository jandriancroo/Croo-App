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

    // Try every possible field name to find delivery partner info
    const allPossibleFields = [
      "checkNumber", "orderTypeName", "orderChannelName", "daypartName",
      "date", "checkState", "employee", "terminalName", "location",
      "description", "referenceNumber", "ticketReference",
      // Possible delivery partner fields
      "thirdPartyName", "thirdPartyOrderId", "vendorName", "vendor",
      "deliveryPartner", "deliveryService", "orderSource", "sourceName",
      "channelName", "channelType", "orderChannel", "marketplaceName",
      "marketplace", "externalOrderId", "externalReference",
      "oloVendor", "oloSource", "oloPartner", "oloProvider",
      "thirdPartySource", "thirdPartyVendor", "thirdPartyProvider",
      "orderOrigin", "orderProvider", "providerName",
      "guestName", "customerName", "customerEmail", "customerPhone",
      // Revenue fields
      "itemSales", "grossSales", "netSales", "taxes", "tips",
      "discounts", "serviceCharges", "itemsSoldCount",
      "checkAmountDue", "checkAmountPaid",
      // Try subreport fields
      "itemName", "quantity", "category", "itemGroup",
      "modifierName", "modifiers", "itemModifiers",
    ];

    // Request with ALL fields - QU will just ignore unknown ones
    const res = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: allPossibleFields.map(f => ({ fieldName: f })),
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
            // Try to filter for OLO orders only
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 10, sort: [{ field: "date", dir: "desc" }] },
        }),
      }
    );
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      // Show first 3 items with ALL their keys
      results['all-fields'] = {
        status: res.status,
        availableKeys: data.items?.[0] ? Object.keys(data.items[0]) : [],
        items: data.items?.slice(0, 3),
      };
    } catch {
      results['all-fields'] = { status: res.status, body: text.substring(0, 1000) };
    }

    // Also try the "order-channel" or "olo" report
    const oloReports = [
      'olo-summary', 'olo-detail', 'online-orders', 'third-party-orders',
      'delivery-orders', 'marketplace-orders', 'order-channel-summary',
      'channel-summary', 'order-source',
    ];

    for (const report of oloReports) {
      try {
        const r = await fetch(
          `https://gateway-api.qubeyond.com/api/v4/data/reports/${report}/sections/main`,
          {
            method: 'POST',
            headers: h,
            body: JSON.stringify({
              fields: [
                { fieldName: "orderChannelName" },
                { fieldName: "thirdPartyName" },
                { fieldName: "vendorName" },
                { fieldName: "checkNumber" },
                { fieldName: "netSales" },
                { fieldName: "quantity" },
                { fieldName: "date" },
              ],
              filters: {
                date: { from: today, to: today, type: "custom" },
                location: { operationalUnits: [storeId] },
              },
              params: { sectionId: "main", pageNumber: 1, pageSize: 5 },
            }),
          }
        );
        const t = await r.text();
        if (r.ok && t) {
          try { results[`report-${report}`] = { status: r.status, data: JSON.parse(t) }; }
          catch { results[`report-${report}`] = { status: r.status, body: t.substring(0, 500) }; }
        } else {
          results[`report-${report}`] = { status: r.status };
        }
      } catch (e) {
        results[`report-${report}`] = { error: e.message.substring(0, 200) };
      }
    }

    // Also check the payment-types report for OLO breakdown  
    const payRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/payment-types/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "paymentTypeName" },
            { fieldName: "amount" },
            { fieldName: "count" },
            { fieldName: "netSales" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 20 },
        }),
      }
    );
    const payText = await payRes.text();
    try { results['payment-types'] = { status: payRes.status, data: JSON.parse(payText) }; }
    catch { results['payment-types'] = { status: payRes.status, body: payText.substring(0, 500) }; }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
