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
  console.log(`[CREATE-CHECKOUT] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabase.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { email: user.email });

    const { priceId, organizationId, locationId } = await req.json();
    if (!priceId) throw new Error("priceId is required");
    if (!locationId) throw new Error("locationId is required");
    logStep("Request params", { priceId, organizationId, locationId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    // Fetch location and org info
    const { data: locationData } = await supabase
      .from("locations")
      .select("name, store_number, organization_id")
      .eq("id", locationId)
      .single();

    const locationName = locationData?.name || "";
    const storeNumber = locationData?.store_number || "";
    const effectiveOrgId = organizationId || locationData?.organization_id || "";

    let orgName = "";
    if (effectiveOrgId) {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", effectiveOrgId)
        .single();
      orgName = orgData?.name || "";
    }

    logStep("Location info", { locationName, storeNumber, orgName });

    // Update Stripe customer with org info
    if (customerId && orgName) {
      await stripe.customers.update(customerId, {
        description: orgName,
        metadata: { organization_id: effectiveOrgId, organization_name: orgName },
      });
    }

    const origin = req.headers.get("origin") || "https://croohq.lovable.app";

    const subscriptionData: any = {
      metadata: {
        organization_id: effectiveOrgId,
        organization_name: orgName,
        location_id: locationId,
        location_name: locationName,
        store_number: storeNumber,
        created_by_user_id: user.id,
      },
    };

    if (!skipTrial) {
      subscriptionData.trial_period_days = 14;
    }

    // Per-location billing: quantity is always 1
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      allow_promotion_codes: true,
      consent_collection: {
        terms_of_service: "required",
      },
      subscription_data: subscriptionData,
      success_url: `${origin}/settings?checkout=success`,
      cancel_url: `${origin}/settings?checkout=canceled`,
    });

    logStep("Checkout session created", { sessionId: session.id, locationId, locationName });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
