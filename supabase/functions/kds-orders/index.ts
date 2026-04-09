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

// Allowed QU store IDs: Palm Springs = 5280, Hemet = 5448
const ALLOWED_STORES: Record<string, number> = {
  '5280': 5280,
  '5448': 5448,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { storeId } = await req.json();
    const quStoreId = ALLOWED_STORES[String(storeId)];
    if (!quStoreId) {
      return new Response(JSON.stringify({ error: "Invalid or unauthorized store" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await authenticateV4();
    if (!token) {
      return new Response(JSON.stringify({ error: "QU auth failed" }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const h = getHeaders(token);
    const today = new Date().toISOString().split('T')[0];

    // Fetch check-detail for today's orders
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
            { fieldName: "description" },
            { fieldName: "itemsSoldCount" },
            { fieldName: "discounts" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [quStoreId] },
          },
          params: { sectionId: "main", pageNumber: 1, pageSize: 200, sort: [{ field: "date", dir: "desc" }] },
        }),
      }
    );

    let orders: any[] = [];
    if (checkRes.ok) {
      const text = await checkRes.text();
      try {
        const data = JSON.parse(text);
        orders = (data.items || []).map((item: any) => ({
          checkNumber: item.checkNumber || '',
          customerName: item.description || '',
          orderType: item.orderTypeName || '',
          channel: item.orderChannelName || '',
          daypart: item.daypartName || '',
          date: item.date || '',
          state: item.checkState || '',
          employee: item.employee || '',
          terminal: item.terminalName || '',
          itemCount: parseInt(item.itemsSoldCount || '0'),
          grossSales: parseFloat((item.grossSales || '0').replace(/,/g, '')),
          netSales: parseFloat((item.netSales || '0').replace(/,/g, '')),
          taxes: parseFloat((item.taxes || '0').replace(/,/g, '')),
          tips: parseFloat((item.tips || '0').replace(/,/g, '')),
          discounts: parseFloat((item.discounts || '0').replace(/,/g, '')),
        }));
      } catch { /* ignore parse errors */ }
    }

    // Fetch payment summary for delivery partner breakdown
    const payRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/payments",
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          fields: [{ fieldName: "paymentTypeName" }, { fieldName: "amount" }, { fieldName: "count" }],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [quStoreId] },
          },
          params: { sectionId: "payments", pageNumber: 1, pageSize: 50 },
        }),
      }
    );

    let payments: { name: string; total: number }[] = [];
    if (payRes.ok) {
      const text = await payRes.text();
      try {
        const data = JSON.parse(text);
        payments = (data.items || [])
          .filter((item: any) => item.metric && typeof item.metric === 'object')
          .map((item: any) => ({
            name: item.metric?.value || '',
            total: parseFloat((item.total || '0').replace(/,/g, '')),
          }));
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({ orders, payments, storeId: quStoreId, date: today }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
