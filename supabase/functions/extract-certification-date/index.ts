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
    const { imageUrl, imageBase64 } = await req.json();
    
    if (!imageUrl && !imageBase64) {
      return new Response(
        JSON.stringify({ error: 'Image URL or base64 data required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-certification-date] Analyzing certificate image...');

    // Build the image content for the API
    const imageContent = imageBase64 
      ? { type: "image_url", image_url: { url: imageBase64 } }
      : { type: "image_url", image_url: { url: imageUrl } };

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are an expert at reading food safety certificates and extracting expiration dates. 
Analyze the certificate image and extract the expiration date.
Common certificate types include:
- Food Handler's Card / Food Handler Certificate
- ServSafe Certification
- Food Safety Manager Certification

Look for text like "Expires:", "Expiration Date:", "Valid Until:", "Exp:", or similar.
The date might be in various formats like MM/DD/YYYY, Month DD, YYYY, etc.

IMPORTANT: Return ONLY a JSON object with no other text. Format:
{"expiration_date": "YYYY-MM-DD", "confidence": "high|medium|low", "certificate_type": "food_handlers|servsafe|other"}

If you cannot find an expiration date, return:
{"expiration_date": null, "confidence": "none", "certificate_type": "unknown"}`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please analyze this certificate image and extract the expiration date.' },
              imageContent
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[extract-certification-date] AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded, please try again later' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to analyze certificate' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log('[extract-certification-date] AI response:', content);

    // Parse the JSON response from the AI
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('[extract-certification-date] Parsed result:', parsed);
        
        return new Response(
          JSON.stringify({
            success: true,
            expiration_date: parsed.expiration_date,
            confidence: parsed.confidence || 'medium',
            certificate_type: parsed.certificate_type || 'unknown'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (parseError) {
      console.error('[extract-certification-date] Failed to parse AI response:', parseError);
    }

    // Fallback if JSON parsing fails
    return new Response(
      JSON.stringify({
        success: false,
        expiration_date: null,
        confidence: 'none',
        certificate_type: 'unknown',
        raw_response: content
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-certification-date] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
