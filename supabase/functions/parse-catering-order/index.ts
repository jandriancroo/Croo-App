import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();
    
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Image URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Parsing catering order from:", imageUrl);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a catering order parser. Extract order details from images/PDFs and return structured data. Always respond with valid JSON using the extract_order_details function.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Parse this catering order. Extract the customer name, order number, pickup date, pickup time, headcount, and all items with quantities. Ignore prices."
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_order_details",
              description: "Extract catering order details from an image",
              parameters: {
                type: "object",
                properties: {
                  customer_name: { type: "string", description: "Customer name" },
                  order_number: { type: "string", description: "Order number/ID" },
                  pickup_date: { type: "string", description: "Pickup date in YYYY-MM-DD format" },
                  pickup_time: { type: "string", description: "Pickup time in HH:MM format (24-hour)" },
                  headcount: { type: "number", description: "Number of people/headcount if mentioned" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        quantity: { type: "number" },
                        item: { type: "string" },
                        notes: { type: "string" }
                      },
                      required: ["quantity", "item"]
                    },
                    description: "List of items with quantities"
                  },
                  notes: { type: "string", description: "Any special instructions or notes" }
                },
                required: ["customer_name", "pickup_date", "pickup_time", "items"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_order_details" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits depleted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    console.log("AI response:", JSON.stringify(result, null, 2));

    // Extract the tool call arguments
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "extract_order_details") {
      throw new Error("Failed to extract order details from AI response");
    }

    const orderDetails = JSON.parse(toolCall.function.arguments);
    console.log("Parsed order details:", orderDetails);

    return new Response(
      JSON.stringify({ success: true, data: orderDetails }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error parsing catering order:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to parse order" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
