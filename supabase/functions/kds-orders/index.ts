import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORE_TIME_ZONE = "America/Los_Angeles";
const RECENT_ORDER_WINDOW_MINUTES = 90;

const ALLOWED_STORES: Record<string, number> = {
  "5280": 5280,
  "5448": 5448,
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
    { method: "POST", body: formData },
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

function getLosAngelesToday(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

function parseQuDateToIso(dateValue: string | null | undefined): string | null {
  if (!dateValue) return null;

  const match = dateValue.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;

  const [, month, day, year, hourText, minuteText, meridiem] = match;
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;

  const utcGuess = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour,
    Number(minuteText),
    0,
  ));

  const offsetMs = getTimeZoneOffsetMs(utcGuess, STORE_TIME_ZONE);
  return new Date(utcGuess.getTime() - offsetMs).toISOString();
}

function isRecentOrder(openedAtIso: string): boolean {
  return Date.now() - new Date(openedAtIso).getTime() <= RECENT_ORDER_WINDOW_MINUTES * 60 * 1000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { storeId, action, checkNumber } = await req.json();
    const normalizedStoreId = String(storeId);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "bump" || action === "clear") {
      if (action === "bump") {
        const { error } = await supabase
          .from("kds_orders")
          .update({ status: "ready", bumped_at: new Date().toISOString() })
          .eq("store_id", normalizedStoreId)
          .eq("check_number", String(checkNumber))
          .eq("status", "open");

        if (error) throw error;
      }

      if (action === "clear") {
        const { error } = await supabase
          .from("kds_orders")
          .update({ status: "cleared", cleared_at: new Date().toISOString() })
          .eq("store_id", normalizedStoreId)
          .eq("check_number", String(checkNumber))
          .eq("status", "ready");

        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const quStoreId = ALLOWED_STORES[normalizedStoreId];
    if (!quStoreId) {
      return new Response(JSON.stringify({ error: "Invalid or unauthorized store" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await authenticateV4();
    if (!token) {
      return new Response(JSON.stringify({ error: "QU auth failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = getHeaders(token);
    const today = getLosAngelesToday();

    const checkRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
      {
        method: "POST",
        headers,
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
            { fieldName: "customerName" },
            { fieldName: "externalOrderId" },
            { fieldName: "promisedTime" },
            { fieldName: "itemsSoldCount" },
            { fieldName: "discounts" },
            { fieldName: "paymentsAmount" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [quStoreId] },
          },
          params: {
            sectionId: "main",
            pageNumber: 1,
            pageSize: 200,
            sort: [{ field: "date", dir: "desc" }],
          },
        }),
      },
    );

    let orders: any[] = [];
    if (checkRes.ok) {
      const text = await checkRes.text();
      try {
        const data = JSON.parse(text);
        orders = (data.items || [])
          .filter((item: any) => item.checkNumber && item.checkNumber !== "Total")
          .map((item: any) => ({
            checkNumber: item.checkNumber || "",
            customerName: item.customerName || item.externalOrderId || item.description || item.checkNumber || "",
            orderType: item.orderTypeName || "",
            channel: item.orderChannelName || "",
            daypart: item.daypartName || "",
            date: item.date || "",
            state: item.checkState || "",
            employee: item.employee || "",
            terminal: item.terminalName || "",
            itemCount: parseInt(item.itemsSoldCount || "0"),
            grossSales: parseFloat((item.grossSales || "0").replace(/,/g, "")),
            netSales: parseFloat((item.netSales || "0").replace(/,/g, "")),
            taxes: parseFloat((item.taxes || "0").replace(/,/g, "")),
            tips: parseFloat((item.tips || "0").replace(/,/g, "")),
            discounts: parseFloat((item.discounts || "0").replace(/,/g, "")),
            paymentsAmount: parseFloat((item.paymentsAmount || "0").replace(/,/g, "")),
            externalOrderId: item.externalOrderId || null,
            promisedTime: item.promisedTime || null,
          }));
      } catch {
        orders = [];
      }
    }

    const itemsByCheck: Record<string, any[]> = {};

    try {
      // Get recent check numbers
      const recentCheckNumbers = new Set(
        orders
          .filter((o: any) => {
            const openedAt = parseQuDateToIso(o.date);
            return openedAt && isRecentOrder(openedAt);
          })
          .map((o: any) => o.checkNumber)
          .filter(Boolean)
      );

      if (recentCheckNumbers.size > 0) {
        // Step 1: Fetch check-detail to get checkNumberSubreport drill-down params
        const checkDetailRes = await fetch(
          "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              fields: [{ fieldName: "checkNumber" }],
              filters: {
                date: { from: today, to: today, type: "custom" },
                location: { operationalUnits: [quStoreId] },
              },
              params: { sectionId: "main", pageNumber: 1, pageSize: 500, showTotals: false },
            }),
          }
        );

        if (checkDetailRes.ok) {
          const checkData = await checkDetailRes.json();
          const checkRows = checkData.items || [];

          // Step 2: For each recent check, use the checkNumberSubreport to drill down
          const subreportFilters: { checkNum: string; filters: any; params: any }[] = [];
          for (const row of checkRows) {
            const cn = row.checkNumber;
            if (!cn || !recentCheckNumbers.has(cn)) continue;
            if (row.checkNumberSubreport) {
              subreportFilters.push({
                checkNum: cn,
                filters: row.checkNumberSubreport.filters || {},
                params: row.checkNumberSubreport.params || {},
              });
            }
          }

          console.log(`Found ${subreportFilters.length} subreport links for ${recentCheckNumbers.size} recent checks`);
          if (subreportFilters.length > 0) {
            console.log("Sample subreport:", JSON.stringify(subreportFilters[0]).slice(0, 500));
          }

          // Step 3: Drill into each subreport (batched, max 20)
          const toFetch = subreportFilters.slice(0, 20);
          
          const fetchSubreport = async (sr: typeof subreportFilters[0]) => {
            try {
              // The subreport typically uses check-detail with different filters/params
              const r = await fetch(
                "https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main",
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    fields: [
                      { fieldName: "itemName" },
                      { fieldName: "menuItemName" },
                      { fieldName: "modifierName" },
                      { fieldName: "quantity" },
                      { fieldName: "netSales" },
                      { fieldName: "itemGroup" },
                    ],
                    filters: sr.filters,
                    params: { ...sr.params, showTotals: false },
                  }),
                }
              );
              if (!r.ok) {
                if (sr.checkNum === toFetch[0]?.checkNum) {
                  console.log(`Subreport failed: ${r.status} for check ${sr.checkNum}`);
                }
                return;
              }
              const data = await r.json();
              const rows = data.items || data.data || [];
              const flat: any[] = [];
              for (const entry of rows) {
                if (Array.isArray(entry.items)) flat.push(...entry.items);
                else flat.push(entry);
              }
              
              if (sr.checkNum === toFetch[0]?.checkNum) {
                console.log(`Subreport for check ${sr.checkNum}: ${flat.length} rows`);
                if (flat.length > 0) {
                  console.log("Subreport row keys:", Object.keys(flat[0]));
                  console.log("Subreport sample:", JSON.stringify(flat[0]).slice(0, 400));
                }
              }

              if (flat.length > 0) {
                itemsByCheck[sr.checkNum] = [];
                for (const row of flat) {
                  const itemName = row.menuItemName || row.itemName || row.name || "";
                  const modName = row.modifierName || row.modifier || "";
                  if (!itemName && !modName) continue;
                  itemsByCheck[sr.checkNum].push({
                    name: itemName || modName,
                    modifier: modName || null,
                    qty: parseInt(row.quantity || row.qty || "1"),
                    price: parseFloat(((row.netSales || row.grossSales || "0") + "").replace(/,/g, "")),
                    category: row.itemGroup || row.itemGroupName || "",
                    isModifier: !!modName && !itemName,
                  });
                }
              }
            } catch (e) {
              // Skip failed
            }
          };

          // Batch in groups of 5
          for (let i = 0; i < toFetch.length; i += 5) {
            await Promise.all(toFetch.slice(i, i + 5).map(fetchSubreport));
          }
        }

        console.log(`Items resolved for ${Object.keys(itemsByCheck).length} checks`);
      }
    } catch (error) {
      console.log("Item detail fetch failed:", error);
    }

    let recentOpenCount = 0;

    for (const order of orders) {
      const openedAtIso = parseQuDateToIso(order.date) || new Date().toISOString();
      const recent = isRecentOrder(openedAtIso);

      if (!recent) continue;

      const items = itemsByCheck[order.checkNumber] || [];
      const isDelivery = order.channel === "OLO" ||
        order.channel.toLowerCase().includes("doordash") ||
        order.channel.toLowerCase().includes("ubereats") ||
        order.channel.toLowerCase().includes("grubhub");

      const { data: existing } = await supabase
        .from("kds_orders")
        .select("status, cleared_at")
        .eq("store_id", normalizedStoreId)
        .eq("check_number", order.checkNumber)
        .maybeSingle();

      if (existing?.status === "cleared" && existing.cleared_at) {
        continue;
      }

      const nextStatus = existing?.status === "ready" ? "ready" : "open";
      if (nextStatus === "open") recentOpenCount += 1;

      // Online/3PD orders are always pre-paid; only in-store needs payment check
      let isPaid: boolean;
      if (isDelivery) {
        isPaid = true;
      } else {
        const totalOwed = order.netSales + order.taxes;
        isPaid = order.paymentsAmount > 0
          ? order.paymentsAmount >= totalOwed * 0.99
          : (order.state || "").toLowerCase() === "closed";
      }

      const { error } = await supabase
        .from("kds_orders")
        .upsert({
          store_id: normalizedStoreId,
          check_number: order.checkNumber,
          customer_name: order.customerName || null,
          order_type: isDelivery ? "Delivery" : order.orderType,
          channel: order.channel,
          employee: order.employee || null,
          items,
          gross_sales: order.grossSales,
          status: nextStatus,
          opened_at: openedAtIso,
          is_paid: isPaid,
          external_order_id: order.externalOrderId || null,
          promised_time: order.promisedTime || null,
        }, { onConflict: "store_id,check_number" });

      if (error) throw error;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("kds_orders")
      .delete()
      .eq("store_id", normalizedStoreId)
      .eq("status", "cleared")
      .lt("cleared_at", twoHoursAgo);

    const payRes = await fetch(
      "https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/payments",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          fields: [
            { fieldName: "paymentTypeName" },
            { fieldName: "amount" },
            { fieldName: "count" },
          ],
          filters: {
            date: { from: today, to: today, type: "custom" },
            location: { operationalUnits: [quStoreId] },
          },
          params: { sectionId: "payments", pageNumber: 1, pageSize: 50 },
        }),
      },
    );

    let payments: { name: string; total: number }[] = [];

    if (payRes.ok) {
      const text = await payRes.text();
      try {
        const data = JSON.parse(text);
        payments = (data.items || [])
          .filter((item: any) => item.metric && typeof item.metric === "object")
          .map((item: any) => ({
            name: item.metric?.value || "",
            total: parseFloat((item.total || "0").replace(/,/g, "")),
          }));
      } catch {
        payments = [];
      }
    }

    return new Response(JSON.stringify({
      orders,
      payments,
      storeId: quStoreId,
      date: today,
      synced: true,
      recentWindowMinutes: RECENT_ORDER_WINDOW_MINUTES,
      recentOpenCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
