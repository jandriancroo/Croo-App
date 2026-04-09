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
  return (await response.json()).access_token || null;
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
    if (!token) throw new Error("QU auth failed");
    const h = getHeaders(token);
    const results: Record<string, any> = {};
    const storeId = 5280;
    const today = new Date().toISOString().split('T')[0];

    // 1. Payments summary - we know this works and shows "OLO Doordash" etc
    const paySummary = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/payments",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [{ fieldName: "paymentTypeName" }, { fieldName: "amount" }, { fieldName: "count" }],
          filters: { date: { from: today, to: today, type: "custom" }, location: { operationalUnits: [storeId] } },
          params: { sectionId: "payments", pageNumber: 1, pageSize: 50 },
        }),
      }
    );
    const payText = await paySummary.text();
    try { results['payments-summary'] = { status: paySummary.status, data: JSON.parse(payText) }; }
    catch { results['payments-summary'] = { status: paySummary.status, body: payText.substring(0, 1000) }; }

    // 2. Check-detail subreport for the OLO order (checkId from earlier)
    const oloCheckId = "69d7e4746b2ba6a6dfe9ce9b";
    
    // Try GET instead of POST for subreport
    const subGet = await fetch(
      `https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main/subreport/checkNumber/${oloCheckId}`,
      { headers: h }
    );
    const subGetText = await subGet.text();
    try { results['subreport-GET'] = { status: subGet.status, data: JSON.parse(subGetText) }; }
    catch { results['subreport-GET'] = { status: subGet.status, body: subGetText.substring(0, 500) }; }

    // 3. Try check-detail with "paymentTypeName" field - this might show DoorDash/Grubhub per check
    const checkWithPayment = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "checkNumber" },
            { fieldName: "orderTypeName" },
            { fieldName: "orderChannelName" },
            { fieldName: "date" },
            { fieldName: "checkState" },
            { fieldName: "netSales" },
            { fieldName: "description" },
            { fieldName: "employee" },
            { fieldName: "referenceNumber" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
            // Try filtering by OLO channel
            orderChannel: { values: ["OLO"] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 20, sort: [{ field: "date", dir: "desc" }] },
        }),
      }
    );
    const cwpText = await checkWithPayment.text();
    try { results['checks-olo-filtered'] = { status: checkWithPayment.status, data: JSON.parse(cwpText) }; }
    catch { results['checks-olo-filtered'] = { status: checkWithPayment.status, body: cwpText.substring(0, 1000) }; }

    // 4. Try check-detail with a "payments" section
    const checkPaySection = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/payments",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "checkNumber" },
            { fieldName: "paymentTypeName" },
            { fieldName: "amount" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
          },
          params: { sectionId: "payments", pageNumber: 1, pageSize: 20 },
        }),
      }
    );
    const cpsText = await checkPaySection.text();
    try { results['check-detail-payments-section'] = { status: checkPaySection.status, data: JSON.parse(cpsText) }; }
    catch { results['check-detail-payments-section'] = { status: checkPaySection.status, body: cpsText.substring(0, 500) }; }

    // 5. Try the "payments/main" report directly
    const payMain = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/payments/sections/main",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [
            { fieldName: "paymentTypeName" },
            { fieldName: "checkNumber" },
            { fieldName: "amount" },
            { fieldName: "date" },
            { fieldName: "orderTypeName" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [storeId] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 20 },
        }),
      }
    );
    const pmText = await payMain.text();
    try { results['payments-main'] = { status: payMain.status, data: JSON.parse(pmText) }; }
    catch { results['payments-main'] = { status: payMain.status, body: pmText.substring(0, 500) }; }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
