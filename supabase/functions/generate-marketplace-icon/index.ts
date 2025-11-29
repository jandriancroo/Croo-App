import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { variant } = await req.json();

    let prompt = "";
    switch (variant) {
      case 1:
        prompt = "A clean, modern app icon for a shift marketplace. Features a minimalist calendar grid with a dollar sign symbol elegantly overlaid in the center. Use a professional color palette of teal blue and gold. Square icon with rounded corners, flat design style, icon design, simple and memorable.";
        break;
      case 2:
        prompt = "A vibrant app icon for a shift marketplace. Shows a stylized calendar page with coins cascading from it, representing money and scheduling. Use bright colors like orange and green. Square icon with rounded corners, modern flat design, professional, icon design.";
        break;
      case 3:
        prompt = "A sleek app icon for a shift marketplace. Features an abstract representation of a calendar square transforming into a dollar bill or coin. Use cool colors like navy blue and silver/white. Minimalist design, square icon with rounded corners, professional icon design.";
        break;
      default:
        throw new Error('Invalid variant');
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image-preview",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        modalities: ["image", "text"]
      })
    });

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      throw new Error('Failed to generate image');
    }

    return new Response(
      JSON.stringify({ imageUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
