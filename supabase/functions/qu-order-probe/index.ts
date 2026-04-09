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

    // Use Palm Springs store as test (5280)
    const storeId = 5280;
    const today = new Date().toISOString().split('T')[0];

    // List of endpoint patterns to probe
    const tests: { name: string; url: string; method?: string; body?: string }[] = [
      // Orders endpoints
      { name: 'orders-list', url: `https://gateway-api.qubeyond.com/api/v4/orders?locationId=${storeId}&date=${today}` },
      { name: 'orders-active', url: `https://gateway-api.qubeyond.com/api/v4/orders/active?locationId=${storeId}` },
      { name: 'orders-recent', url: `https://gateway-api.qubeyond.com/api/v4/orders/recent?locationId=${storeId}` },
      { name: 'orders-open', url: `https://gateway-api.qubeyond.com/api/v4/orders/open?locationId=${storeId}` },
      
      // Transactions endpoints
      { name: 'transactions', url: `https://gateway-api.qubeyond.com/api/v4/transactions?locationId=${storeId}&date=${today}` },
      { name: 'transactions-recent', url: `https://gateway-api.qubeyond.com/api/v4/transactions/recent?locationId=${storeId}` },
      
      // Data/reports endpoints for orders
      { name: 'data-orders', url: `https://gateway-api.qubeyond.com/api/v4/data/orders?locationId=${storeId}&from=${today}&to=${today}` },
      
      // Report-based order detail
      { name: 'report-order-detail', url: `https://gateway-api.qubeyond.com/api/v4/data/reports/order-detail/sections/main`, method: 'POST', body: JSON.stringify({
        fields: [
          { fieldName: "orderNumber" },
          { fieldName: "orderType" },
          { fieldName: "orderStatus" },
          { fieldName: "itemName" },
          { fieldName: "quantity" },
          { fieldName: "netSales" },
          { fieldName: "openDate" },
          { fieldName: "closeDate" },
        ],
        filters: {
          date: { from: today, to: today, type: "custom" },
          location: { operationalUnits: [storeId] },
        },
        params: { sectionId: "main", pageNumber: 1, pageSize: 20, sort: [{ field: "openDate", dir: "desc" }] },
      })},
      
      // Transaction detail report
      { name: 'report-transaction-detail', url: `https://gateway-api.qubeyond.com/api/v4/data/reports/transaction-detail/sections/main`, method: 'POST', body: JSON.stringify({
        fields: [
          { fieldName: "checkNumber" },
          { fieldName: "orderType" },
          { fieldName: "itemName" },
          { fieldName: "quantity" },
          { fieldName: "netSales" },
          { fieldName: "openDate" },
          { fieldName: "closeDate" },
          { fieldName: "guestName" },
        ],
        filters: {
          date: { from: today, to: today, type: "custom" },
          location: { operationalUnits: [storeId] },
        },
        params: { sectionId: "main", pageNumber: 1, pageSize: 20, sort: [{ field: "openDate", dir: "desc" }] },
      })},

      // Check detail report
      { name: 'report-check-detail', url: `https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main`, method: 'POST', body: JSON.stringify({
        fields: [
          { fieldName: "checkNumber" },
          { fieldName: "orderType" },
          { fieldName: "itemName" },
          { fieldName: "quantity" },
          { fieldName: "netSales" },
          { fieldName: "openDate" },
          { fieldName: "closeDate" },
        ],
        filters: {
          date: { from: today, to: today, type: "custom" },
          location: { operationalUnits: [storeId] },
        },
        params: { sectionId: "main", pageNumber: 1, pageSize: 20, sort: [{ field: "openDate", dir: "desc" }] },
      })},

      // List available reports
      { name: 'reports-list', url: `https://gateway-api.qubeyond.com/api/v4/data/reports` },
      
      // Tickets
      { name: 'tickets', url: `https://gateway-api.qubeyond.com/api/v4/tickets?locationId=${storeId}&date=${today}` },
      
      // Checks
      { name: 'checks', url: `https://gateway-api.qubeyond.com/api/v4/checks?locationId=${storeId}&date=${today}` },
      { name: 'checks-open', url: `https://gateway-api.qubeyond.com/api/v4/checks/open?locationId=${storeId}` },
    ];

    for (const t of tests) {
      try {
        const opts: any = { headers: h, method: t.method || 'GET' };
        if (t.body) opts.body = t.body;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        opts.signal = controller.signal;
        const res = await fetch(t.url, opts);
        clearTimeout(timeout);
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text.substring(0, 1000); }
        results[t.name] = {
          status: res.status,
          body: typeof body === 'string' ? body : JSON.stringify(body).substring(0, 1500),
        };
      } catch (e) {
        results[t.name] = { error: e.message.substring(0, 300) };
      }
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
