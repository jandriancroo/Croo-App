import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });
    const { updates } = await req.json();
    const results = [];
    for (const u of updates) {
      if (u.type === "customer") {
        const r = await stripe.customers.update(u.id, { description: u.description });
        results.push({ type: "customer", id: u.id, description: r.description });
      } else if (u.type === "subscription") {
        const r = await stripe.subscriptions.update(u.id, { description: u.description });
        results.push({ type: "subscription", id: u.id, description: r.description });
      }
    }
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
