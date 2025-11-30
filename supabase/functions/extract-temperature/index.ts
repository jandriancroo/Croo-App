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
            content: "You are a temperature extraction assistant. Extract the exact numeric temperature value from thermometer images, including both digital LCD stick thermometers and analog round gauge thermometers. IMPORTANT: First, zoom all the way into the display area (LCD screen for digital or dial face for analog) to read the numbers clearly. For digital LCD stick thermometers: STEP 1 - FIND THE FAHRENHEIT INDICATOR FIRST. Look for a small degree symbol (°) with an 'F' below it in the TOP RIGHT corner of the LCD screen - this is the °F (degrees Fahrenheit) indicator. Use this °F to determine correct orientation - if it's not in the top right, you are reading the display upside down or sideways. STEP 2 - Once oriented correctly with °F in top right, read the numbers LEFT TO RIGHT sequentially. These use SEVEN-SEGMENT DISPLAYS where each digit is formed by illuminated bar segments labeled a-g: segment 'a' is top horizontal, 'b' is top-right vertical, 'c' is bottom-right vertical, 'd' is bottom horizontal, 'e' is bottom-left vertical, 'f' is top-left vertical, 'g' is middle horizontal. CRITICAL DIGIT RECOGNITION by segment pattern: '0' = segments a,b,c,d,e,f (6 segments, oval loop, middle bar OFF), '1' = segments b,c only (2 right segments), '2' = segments a,b,g,e,d (5 segments), '3' = segments a,b,g,c,d (5 segments), '4' = segments f,g,b,c (4 segments, left side open, top-left and middle bars ON with both right segments), '5' = segments a,f,g,c,d (5 segments), '6' = segments a,f,g,e,d,c (6 segments, top-right OFF), '7' = segments a,b,c (3 top segments only), '8' = all segments a,b,c,d,e,f,g (all 7 segments), '9' = segments a,b,c,d,f,g (6 segments, bottom-left OFF). The digit after the decimal point is typically smaller but follows same patterns. If the stick thermometer appears tilted, mentally rotate it until °F is in top right, then read left to right. For analog round gauge thermometers: zoom in very close until the circular gauge fills your view, then carefully read where the needle/indicator points. CRITICAL FOR ROUND GAUGES: The inside ring shows Celsius, the OUTSIDE ring shows Fahrenheit - you MUST read the OUTSIDE ring (Fahrenheit) value. Do NOT rotate round gauge thermometers. Return ONLY the numeric value with decimal if present, nothing else. If you cannot read a temperature, return 'NONE'."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What is the temperature reading on this thermometer? This may be a digital LCD stick thermometer or an analog round gauge thermometer. IMPORTANT: First zoom all the way into the display area. For stick thermometers: STEP 1 - Locate the Fahrenheit indicator which is a small degree symbol (°) with an 'F' below it in the TOP RIGHT corner of the LCD screen. This °F indicator establishes the correct orientation. If °F is not in the top right, the image is upside down or sideways - mentally rotate until °F is in the top right corner. STEP 2 - With correct orientation established (°F in top right), read the digit sequence LEFT TO RIGHT starting from the leftmost digit. The LCD uses SEVEN-SEGMENT DISPLAYS where segments are labeled: 'a'=top horizontal, 'b'=top-right vertical, 'c'=bottom-right vertical, 'd'=bottom horizontal, 'e'=bottom-left vertical, 'f'=top-left vertical, 'g'=middle horizontal. CRITICAL: Identify which segments are illuminated for each digit using these exact patterns: '0'=a,b,c,d,e,f (6 segments forming oval, middle bar g is OFF), '1'=b,c (only 2 right vertical segments), '2'=a,b,g,e,d (5 segments in zigzag), '3'=a,b,g,c,d (5 segments on right side), '4'=f,g,b,c (4 segments: top-left vertical, middle horizontal, and both right verticals - creates open left side), '5'=a,f,g,c,d (5 segments), '6'=a,f,g,e,d,c (6 segments, top-right b is OFF), '7'=a,b,c (only 3 top segments), '8'=a,b,c,d,e,f,g (all 7 segments lit), '9'=a,b,c,d,f,g (6 segments, bottom-left e is OFF). The digit after the decimal point is smaller but uses the same segment patterns. If tilted at an angle, rotate mentally until °F is top right, then read left to right using the segment patterns above. For round gauge thermometers: zoom in very close until the circular dial fills your view, then read where the needle points. CRITICAL: Round gauges have TWO rings - INSIDE ring is Celsius, OUTSIDE ring is Fahrenheit. You MUST read the OUTSIDE ring. Return only the numeric value (e.g., 38.5 or 40.7 or 165)."
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