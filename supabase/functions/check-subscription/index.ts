import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUBSCRIPTION] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    let organizationId: string | null = null;
    try {
      const body = await req.json();
      organizationId = body?.organization_id ?? null;
    } catch {
      // No body or invalid JSON
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Collect all subscriptions from org admin emails
    let allSubs: any[] = [];
    let customerId: string | null = null;

    if (organizationId) {
      logStep("Org-scoped check", { organizationId });

      const { data: orgAdmins } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId);

      const adminUserIds = new Set<string>();
      if (orgAdmins) {
        for (const m of orgAdmins) adminUserIds.add(m.user_id);
      }
      adminUserIds.add(user.id);

      const { data: adminProfiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", Array.from(adminUserIds));

      const emails = (adminProfiles || []).map((p: any) => p.email).filter(Boolean);
      logStep("Checking org admin emails", { emails: emails.length });

      for (const email of emails) {
        const customers = await stripe.customers.list({ email, limit: 1 });
        if (customers.data.length === 0) continue;

        const cid = customers.data[0].id;
        const activeSubs = await stripe.subscriptions.list({ customer: cid, status: "active", limit: 50 });
        const trialingSubs = await stripe.subscriptions.list({ customer: cid, status: "trialing", limit: 50 });

        const matchingSubs = [...activeSubs.data, ...trialingSubs.data].filter((sub) => {
          const subOrgId = sub.metadata?.organization_id;
          return subOrgId === organizationId;
        });

        if (matchingSubs.length > 0) {
          allSubs.push(...matchingSubs);
          customerId = cid;
          logStep("Found org subscriptions", { customerId: cid, email, subCount: matchingSubs.length });
        }
      }
    } else {
      logStep("User-level check (no org_id provided)");
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        const activeSubs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 50 });
        const trialingSubs = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 50 });
        allSubs = [...activeSubs.data, ...trialingSubs.data];
      }
    }

    if (allSubs.length === 0) {
      logStep("No active or trialing subscriptions");
      return new Response(JSON.stringify({ subscribed: false, location_subscriptions: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Build per-location subscription map
    const locationSubscriptions: Record<string, {
      subscribed: boolean;
      product_id: string;
      subscription_end: string | null;
      trial_end: string | null;
      status: string;
    }> = {};

    const productIds: string[] = [];
    let latestEnd = 0;
    let latestTrialEnd = 0;

    for (const sub of allSubs) {
      const periodEnd = (sub.current_period_end ?? 0) * 1000;
      if (periodEnd > latestEnd) latestEnd = periodEnd;

      if (sub.trial_end) {
        const te = sub.trial_end * 1000;
        if (te > latestTrialEnd) latestTrialEnd = te;
      }

      for (const item of sub.items.data) {
        const pid = typeof item.price.product === "string" ? item.price.product : (item.price.product as any).id;
        if (!productIds.includes(pid)) productIds.push(pid);
      }

      // Map location_id from metadata
      const locId = sub.metadata?.location_id;
      if (locId) {
        const subEnd = periodEnd > 0 ? new Date(periodEnd).toISOString() : null;
        const subTrialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
        const pid = sub.items.data[0]?.price?.product;
        const productId = typeof pid === "string" ? pid : pid?.id || "";

        locationSubscriptions[locId] = {
          subscribed: true,
          product_id: productId,
          subscription_end: subEnd,
          trial_end: subTrialEnd,
          status: sub.status,
        };
      }
    }

    const subscriptionEnd = latestEnd > 0 ? new Date(latestEnd).toISOString() : null;
    const trialEnd = latestTrialEnd > 0 ? new Date(latestTrialEnd).toISOString() : null;

    // Get billable location count
    let locationCount = 0;
    if (organizationId) {
      const { count } = await supabase
        .from("locations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .neq("store_number", "7777");

      locationCount = count ?? 0;
    }

    logStep("Subscription data", { productIds, subscriptionEnd, trialEnd, locationCount, locationSubscriptions });

    return new Response(
      JSON.stringify({
        subscribed: true,
        product_ids: productIds,
        subscription_end: subscriptionEnd,
        trial_end: trialEnd,
        location_count: locationCount,
        organization_id: organizationId,
        location_subscriptions: locationSubscriptions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
