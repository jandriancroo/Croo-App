import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * KDS Stream — Webhook receiver for Qu Data Streaming.
 *
 * Qu pushes order events (creates, updates, status changes) to this endpoint.
 * We parse items + modifiers from each event and upsert into kds_orders.
 *
 * Phase 1 (current): Log every payload verbatim so we can map fields.
 * Phase 2: Full item hydration once we confirm the payload structure.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qu-signature, x-qu-event",
};

const STORE_TIME_ZONE = "America/Los_Angeles";

// Map Qu location IDs to our store IDs
const QU_LOCATION_MAP: Record<number, string> = {
  5280: "5280", // Palm Springs
  5448: "5448", // Hemet
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Accept GET for health checks (Qu may ping the URL to verify)
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "kds-stream" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const rawBody = await req.text();
    const eventType = req.headers.get("x-qu-event") || req.headers.get("x-event-type") || "unknown";
    const signature = req.headers.get("x-qu-signature") || req.headers.get("x-signature") || "";

    // ──────────────────────────────────────────────────
    // PHASE 1: Log everything for field mapping
    // ──────────────────────────────────────────────────
    console.log(`[kds-stream] Event: ${eventType}`);
    console.log(`[kds-stream] Headers: ${JSON.stringify(Object.fromEntries(req.headers.entries()))}`);
    console.log(`[kds-stream] Body (first 2000): ${rawBody.slice(0, 2000)}`);
    if (rawBody.length > 2000) {
      console.log(`[kds-stream] Body (2000-4000): ${rawBody.slice(2000, 4000)}`);
    }

    // Also persist the raw event to a log table for offline analysis
    await supabase.from("kds_stream_events").insert({
      event_type: eventType,
      payload: rawBody,
      headers: JSON.stringify({ signature, eventType }),
    }).then(({ error }) => {
      if (error) console.log(`[kds-stream] Log insert error: ${error.message}`);
    });

    // ──────────────────────────────────────────────────
    // PHASE 2: Attempt to parse and hydrate KDS orders
    // ──────────────────────────────────────────────────
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      console.log("[kds-stream] Non-JSON payload, skipping parse");
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle both single events and batched arrays
    const events = Array.isArray(data) ? data : [data];

    for (const event of events) {
      try {
        await processOrderEvent(supabase, event, eventType);
      } catch (e) {
        console.log(`[kds-stream] Process error: ${e}`);
      }
    }

    return new Response(JSON.stringify({ received: true, count: events.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[kds-stream] Fatal error: ${error}`);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processOrderEvent(supabase: any, event: any, headerEventType: string) {
  // Try to extract location/store ID from various possible field names
  const locationId = event.locationId || event.location_id || event.storeId ||
    event.store_id || event.operationalUnitId || event.siteId || null;

  if (!locationId) {
    console.log(`[kds-stream] No location ID found in event keys: ${Object.keys(event).join(",")}`);
    return;
  }

  const storeId = QU_LOCATION_MAP[Number(locationId)];
  if (!storeId) {
    console.log(`[kds-stream] Unknown location ${locationId}, skipping`);
    return;
  }

  // Try to extract check/order number
  const checkNumber = String(
    event.checkNumber || event.check_number || event.orderNumber ||
    event.order_number || event.ticketNumber || event.id || ""
  );

  if (!checkNumber) {
    console.log(`[kds-stream] No check number in event`);
    return;
  }

  // Try to extract items from various possible structures
  const rawItems = event.items || event.lineItems || event.line_items ||
    event.orderItems || event.order_items || event.details || [];

  const items = Array.isArray(rawItems) ? rawItems.map((item: any) => {
    const modifiers = item.modifiers || item.modifications || item.mods || [];
    return {
      name: item.name || item.itemName || item.item_name || item.description || "",
      modifier: Array.isArray(modifiers) && modifiers.length > 0
        ? modifiers.map((m: any) => m.name || m.modifierName || m.description || "").join(", ")
        : null,
      qty: Number(item.quantity || item.qty || 1),
      price: Number(item.price || item.amount || item.netSales || item.total || 0),
      category: item.category || item.categoryName || item.itemGroup || item.itemGroupName || "",
      isModifier: false,
    };
  }) : [];

  // Extract customer info
  const customerName = event.customerName || event.customer_name ||
    event.guestName || event.guest_name || event.description || checkNumber;

  // Extract order type / channel
  const orderType = event.orderType || event.order_type || event.orderTypeName || "";
  const channel = event.channel || event.orderChannel || event.orderChannelName || "In Store";

  // Determine delivery status
  const isDelivery = /olo|doordash|ubereats|grubhub|delivery/i.test(channel) ||
    /olo|doordash|ubereats|grubhub|delivery/i.test(orderType);

  // Check status
  const eventStatus = (event.status || event.checkState || event.state || "").toLowerCase();
  const isClosed = eventStatus === "closed" || eventStatus === "completed";

  // Get opened timestamp
  const openedAt = event.openedAt || event.opened_at || event.createdAt ||
    event.created_at || event.date || event.timestamp || new Date().toISOString();

  // Check if already bumped/cleared in our system
  const { data: existing } = await supabase
    .from("kds_orders")
    .select("status, cleared_at")
    .eq("store_id", storeId)
    .eq("check_number", checkNumber)
    .maybeSingle();

  if (existing?.status === "cleared") return;

  const kdsStatus = existing?.status === "ready" ? "ready" : "open";

  // Gross sales
  const grossSales = Number(event.grossSales || event.gross_sales || event.total ||
    event.totalAmount || event.amount || 0);

  // Payment / paid status
  const isPaid = isDelivery ? true : (
    isClosed || (Number(event.paymentsAmount || event.amountPaid || 0) >= grossSales * 0.99)
  );

  const { error } = await supabase
    .from("kds_orders")
    .upsert({
      store_id: storeId,
      check_number: checkNumber,
      customer_name: customerName || null,
      order_type: isDelivery ? "Delivery" : (orderType || null),
      channel: channel || null,
      employee: event.employee || event.employeeName || null,
      items: items.length > 0 ? items : undefined, // Only update items if we have them
      gross_sales: grossSales || undefined,
      status: kdsStatus,
      opened_at: openedAt,
      is_paid: isPaid,
      external_order_id: event.externalOrderId || event.external_order_id || null,
      promised_time: event.promisedTime || event.promised_time || null,
    }, { onConflict: "store_id,check_number" });

  if (error) {
    console.log(`[kds-stream] Upsert error for ${checkNumber}: ${error.message}`);
  } else {
    console.log(`[kds-stream] Upserted ${checkNumber} at store ${storeId} with ${items.length} items`);
  }
}
