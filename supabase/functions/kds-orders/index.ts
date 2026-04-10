import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

const ALLOWED_STORES: Record<string, number> = {
  '5280': 5280,
  '5448': 5448,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { storeId, action, checkNumber } = await req.json();

    // Handle bump/clear actions
    if (action === 'bump' || action === 'clear') {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      if (action === 'bump') {
        const { error } = await supabase.from('kds_orders')
          .update({ status: 'ready', bumped_at: new Date().toISOString() })
          .eq('store_id', String(storeId))
          .eq('check_number', String(checkNumber))
          .eq('status', 'open');
        if (error) throw error;
      } else if (action === 'clear') {
        const { error } = await supabase.from('kds_orders')
          .update({ status: 'cleared', cleared_at: new Date().toISOString() })
          .eq('store_id', String(storeId))
          .eq('check_number', String(checkNumber))
          .eq('status', 'ready');
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sync orders flow
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
    // Use PST/PDT for Blaze locations
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).toISOString().split('T')[0];

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
        orders = (data.items || [])
          .filter((item: any) => item.checkNumber && item.checkNumber !== 'Total')
          .map((item: any) => ({
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

    // Try to fetch item-level detail (transaction-details or checks-details)
    let itemsByCheck: Record<string, any[]> = {};
    try {
      const detailRes = await fetch(
        "https://gateway-api.qubeyond.com/api/v4/data/reports/transaction-details/sections/main",
        {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            fields: [
              { fieldName: "checkNumber" },
              { fieldName: "menuItemName" },
              { fieldName: "modifierName" },
              { fieldName: "quantity" },
              { fieldName: "grossSales" },
              { fieldName: "categoryName" },
            ],
            filters: {
              date: { from: today, to: today, type: "custom" },
              location: { operationalUnits: [quStoreId] },
            },
            params: { sectionId: "main", pageNumber: 1, pageSize: 500, sort: [{ field: "checkNumber", dir: "asc" }] },
          }),
        }
      );
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        for (const row of (detailData.items || [])) {
          const cn = row.checkNumber;
          if (!cn || cn === 'Total') continue;
          if (!itemsByCheck[cn]) itemsByCheck[cn] = [];
          itemsByCheck[cn].push({
            name: row.menuItemName || row.modifierName || '',
            modifier: row.modifierName || null,
            qty: parseInt(row.quantity || '1'),
            price: parseFloat((row.grossSales || '0').replace(/,/g, '')),
            category: row.categoryName || '',
            isModifier: !!row.modifierName && !row.menuItemName,
          });
        }
      } else {
        await detailRes.text(); // consume body
      }
    } catch (e) {
      console.log('Item detail fetch failed (non-critical):', e);
    }

    // Upsert into kds_orders table
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    for (const order of orders) {
      const items = itemsByCheck[order.checkNumber] || [];
      const is3PD = order.channel === 'OLO' ||
        order.channel.toLowerCase().includes('doordash') ||
        order.channel.toLowerCase().includes('ubereats') ||
        order.channel.toLowerCase().includes('grubhub');

      // Only upsert if order doesn't already exist with bumped/cleared status
      const { data: existing } = await supabase
        .from('kds_orders')
        .select('status')
        .eq('store_id', String(storeId))
        .eq('check_number', order.checkNumber)
        .maybeSingle();

      // Don't overwrite bumped/cleared orders
      if (existing && (existing.status === 'ready' || existing.status === 'cleared')) {
        continue;
      }

      await supabase.from('kds_orders').upsert({
        store_id: String(storeId),
        check_number: order.checkNumber,
        customer_name: order.customerName || null,
        order_type: is3PD ? 'Delivery' : order.orderType,
        channel: order.channel,
        employee: order.employee || null,
        items: items.length > 0 ? items : [],
        gross_sales: order.grossSales,
        status: order.state === 'Closed' ? 'cleared' : 'open',
        opened_at: order.date ? new Date(order.date).toISOString() : new Date().toISOString(),
      }, { onConflict: 'store_id,check_number' });
    }

    // Clean up old cleared orders (older than 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await supabase.from('kds_orders')
      .delete()
      .eq('store_id', String(storeId))
      .eq('status', 'cleared')
      .lt('cleared_at', twoHoursAgo);

    // Fetch payment summary
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

    return new Response(JSON.stringify({ orders, payments, storeId: quStoreId, date: today, synced: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
