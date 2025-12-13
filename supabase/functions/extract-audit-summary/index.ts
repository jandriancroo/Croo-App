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

    console.log('[extract-audit-summary] Analyzing food safety audit document...');

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
            content: `You are an expert at reading Food Safety Audit documents.
Analyze the document and extract the following information:

1. VISIT SCORE (REQUIRED - you MUST find this):
   - Look for "This Visit" followed by a percentage score (e.g., "This Visit: 95.00%" or "This Visit 95.00%")
   - This is the MAIN audit score and is ALWAYS present on food safety audit reports
   - It may appear near the top of the document, often in a summary section
   - Look for patterns like "This Visit: XX.XX%" or "This Visit XX%" or just a percentage near "This Visit"
   - If you see multiple scores, the "This Visit" score is the one we need
   - DO NOT return null for visit_score - keep looking until you find it
   - RETURN ONLY THE NUMBER without the % symbol (e.g., "95.00" not "95.00%")

2. PRIORITY ITEMS: Extract ALL items listed under each priority category:
   - First Priority Items: Critical violations that need immediate attention (often marked in red)
   - Second Priority Items: Important issues that need to be addressed (often marked in yellow/orange)
   - Third Priority Items: Minor issues or recommendations (often marked in blue/green)

For each priority item, extract just the description/violation text.

IMPORTANT: Return ONLY a JSON object with no other text. Format:
{
  "visit_score": "95.00",
  "first_priority_items": ["Item 1 description", "Item 2 description"],
  "second_priority_items": ["Item 1 description", "Item 2 description"],
  "third_priority_items": ["Item 1 description", "Item 2 description"],
  "audit_date": "YYYY-MM-DD" or null
}

If a priority category has no items, return an empty array [].
The visit_score MUST be a number as a string like "95.00" (no % symbol) - never return null for this field.
Be thorough - extract ALL items from each priority section.`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please analyze this food safety audit document. Find the "This Visit" percentage score and extract all priority items. The visit score is required.' },
              imageContent
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[extract-audit-summary] AI gateway error:', response.status, errorText);
      
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
        JSON.stringify({ error: 'Failed to analyze audit document' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log('[extract-audit-summary] AI response:', content);

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('[extract-audit-summary] Parsed result:', parsed);
        
        return new Response(
          JSON.stringify({
            success: true,
            visit_score: parsed.visit_score || null,
            first_priority_items: parsed.first_priority_items || [],
            second_priority_items: parsed.second_priority_items || [],
            third_priority_items: parsed.third_priority_items || [],
            audit_date: parsed.audit_date || null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (parseError) {
      console.error('[extract-audit-summary] Failed to parse AI response:', parseError);
    }

    return new Response(
      JSON.stringify({
        success: false,
        visit_score: null,
        first_priority_items: [],
        second_priority_items: [],
        third_priority_items: [],
        raw_response: content
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-audit-summary] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
