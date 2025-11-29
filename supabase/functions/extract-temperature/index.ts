import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();
    
    if (!imageUrl) {
      throw new Error("Image URL is required");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Call Lovable AI to extract temperature from image with rotation instruction
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
            content: "You are a temperature extraction assistant. Extract the exact numeric temperature value from thermometer images, including both digital LCD thermometers and analog round gauge thermometers. IMPORTANT: First, zoom all the way into the display area (LCD screen for digital or dial face for analog) to read the numbers clearly. For digital LCD thermometers: note that the digit after the decimal point is typically smaller than the main digits, and there's usually a small 'F' in the top right corner of the LCD screen. If the thermometer appears tilted or at an angle, mentally rotate it to horizontal/upright position before reading (do NOT rotate round gauge thermometers). For analog thermometers, carefully read where the needle/indicator points on the numbered scale. Return ONLY the numeric value with decimal if present, nothing else. If you cannot read a temperature, return 'NONE'."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What is the temperature reading on this thermometer? This may be a digital LCD thermometer or an analog round gauge thermometer. IMPORTANT: First zoom all the way into the display area (LCD screen for digital or dial face for analog) to see the numbers clearly. For digital LCD thermometers, the digit after the decimal point is smaller, and there's a small 'F' in the top right corner. If it's a digital LCD thermometer and appears tilted at an angle, imagine rotating it to be horizontal before reading (do NOT rotate round gauge thermometers). For analog thermometers, read where the needle points on the scale. Return only the numeric value (e.g., 38.5 or 165 or 143)."
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("Failed to extract temperature from image");
    }

    const data = await response.json();
    const extractedText = data.choices?.[0]?.message?.content?.trim() || "NONE";
    
    // Parse the temperature value
    let temperature: number | null = null;
    let isValid = false;
    
    if (extractedText !== "NONE") {
      const tempMatch = extractedText.match(/[-+]?\d+\.?\d*/);
      if (tempMatch) {
        temperature = parseFloat(tempMatch[0]);
        // Food safety temperatures: ≤41.9°F (cold) or ≥165°F (hot)
        isValid = temperature <= 41.9 || temperature >= 165;
      }
    }

    return new Response(
      JSON.stringify({
        temperature,
        isValid,
        extractedText,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in extract-temperature function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});