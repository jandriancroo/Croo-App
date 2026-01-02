import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InventoryItem {
  item_id: string;
  item_name: string;
}

interface ParsedCommand {
  item_name: string;
  cases: number;
  units: number;
  matched_item_id?: string;
  confidence: 'high' | 'medium' | 'low';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, items } = await req.json();

    if (!transcript || !items) {
      throw new Error('Missing transcript or items');
    }

    console.log('[ParseVoice] Processing:', transcript);
    console.log('[ParseVoice] Available items:', items.length);

    // Create a list of item names for the AI
    const itemNames = items.map((i: InventoryItem) => i.item_name).join(', ');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are an inventory voice command parser. Parse the user's spoken command to extract:
1. The item name (match to one of the available items)
2. The number of cases (default 0 if not mentioned)
3. The number of units (default 0 if not mentioned)

Available inventory items: ${itemNames}

Common patterns:
- "Cookies 5 cases" → item: Cookies, cases: 5, units: 0
- "Ranch 2 cases 3 units" → item: Ranch, cases: 2, units: 3
- "Chicken half a case" → item: Chicken, cases: 0.5, units: 0
- "Brownies 1" → item: Brownies, cases: 1, units: 0 (assume cases if not specified)
- "5 cookies" → item: Cookies, cases: 5, units: 0

Match the spoken item name to the closest matching inventory item name. Be flexible with:
- Plurals (cookie vs cookies)
- Common abbreviations
- Similar sounding words

Respond ONLY with valid JSON in this exact format:
{
  "item_name": "matched item name from the list",
  "cases": 0,
  "units": 0,
  "confidence": "high" | "medium" | "low"
}

If you cannot match the item, set confidence to "low".`
          },
          {
            role: 'user',
            content: transcript
          }
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[ParseVoice] AI error:', error);
      throw new Error(`AI request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log('[ParseVoice] AI response:', content);

    // Parse the JSON from the AI response
    let parsed: ParsedCommand;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('[ParseVoice] Parse error:', e);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response', raw: content }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Find the matching item ID
    const matchedItem = items.find((i: InventoryItem) => 
      i.item_name.toLowerCase() === parsed.item_name.toLowerCase()
    );

    if (matchedItem) {
      parsed.matched_item_id = matchedItem.item_id;
    }

    console.log('[ParseVoice] Parsed result:', parsed);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ParseVoice] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
