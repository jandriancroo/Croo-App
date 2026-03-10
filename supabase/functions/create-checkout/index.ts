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

    const { priceId, skipTrial, organizationId } = await req.json();
    if (!priceId) throw new Error("priceId is required");
    logStep("Request params", { priceId, skipTrial, organizationId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Find or create Stripe customer — will update with org info after we fetch it
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    // Calculate billable location count (exclude Sandbox store_number 7777)
    let quantity = 1;
    let orgName = "";
    if (organizationId) {
      const { count } = await supabase
        .from("locations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .neq("store_number", "7777"); // Exclude Sandbox

      quantity = Math.max(count ?? 1, 1);

      // Fetch org name for Stripe metadata
      const { data: orgData } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .single();
      orgName = orgData?.name || "";

      logStep("Billable location count", { organizationId, orgName, quantity });
      // Update Stripe customer with org info so it's visible across Stripe
      if (customerId && orgName) {
        await stripe.customers.update(customerId, {
          description: orgName,
          metadata: { organization_id: organizationId, organization_name: orgName },
        });
      }
    }

    const origin = req.headers.get("origin") || "https://croohq.lovable.app";

    const subscriptionData: any = {
      metadata: {
        organization_id: organizationId || "",
        organization_name: orgName,
        created_by_user_id: user.id,
      },
    };

    if (!skipTrial) {
      subscriptionData.trial_period_days = 14;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity }],
      mode: "subscription",
      allow_promotion_codes: true,
      consent_collection: {
        terms_of_service: "required",
      },
      subscription_data: subscriptionData,
      success_url: `${origin}/settings?checkout=success`,
      cancel_url: `${origin}/settings?checkout=canceled`,
    });

    logStep("Checkout session created", { sessionId: session.id, quantity });

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
