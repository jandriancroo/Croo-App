import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

serve(async (req) => {
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-08-27.basil" });

    // Update Hemet customer with org name
    const updated = await stripe.customers.update("cus_U4Als5jhSUBnWq", {
      description: "Jo Pizza LLC",
      metadata: {
        organization_id: "11111111-1111-1111-1111-111111111111",
        organization_name: "Jo Pizza LLC",
      },
    });

    return new Response(JSON.stringify({ success: true, name: updated.name, description: updated.description, metadata: updated.metadata }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
