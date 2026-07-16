// Parse a PDF or image of a recipe and return structured recipe JSON.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';


const SYSTEM_PROMPT = `You extract structured recipe data from an image or PDF of a recipe (handwritten, typed, book scan, or photo).
Return: title, description, category, tags (array of short strings), yield_qty (number), yield_unit, servings (integer), prep_time_min, cook_time_min, ingredients (array of { name, quantity (number or null), unit }), steps (array of strings — each string is one step in order).
Preserve original wording where possible. If a field is not visible, omit it. Do NOT invent quantities. Return ONLY the tool call.`;

const TOOL_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'extract_recipe',
    description: 'Extract structured recipe from document',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        yield_qty: { type: 'number' },
        yield_unit: { type: 'string' },
        servings: { type: 'integer' },
        prep_time_min: { type: 'integer' },
        cook_time_min: { type: 'integer' },
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string' },
            },
            required: ['name'],
          },
        },
        steps: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const key = Deno.env.get('LOVABLE_API_KEY');
    if (!key) return new Response(JSON.stringify({ error: 'Missing LOVABLE_API_KEY' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { file_base64, content_type } = await req.json();
    if (!file_base64 || !content_type) {
      return new Response(JSON.stringify({ error: 'file_base64 and content_type required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isPdf = String(content_type).includes('pdf');
    const userContent: any[] = [
      isPdf
        ? { type: 'file', file: { filename: 'recipe.pdf', file_data: `data:${content_type};base64,${file_base64}` } }
        : { type: 'image_url', image_url: { url: `data:${content_type};base64,${file_base64}` } },
      { type: 'text', text: 'Extract this recipe.' },
    ];

    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: 'function', function: { name: 'extract_recipe' } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error('AI error', aiResp.status, t);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: 'Rate limited, try again shortly' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: 'AI credits exhausted' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'AI parsing failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const result = await aiResp.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: 'AI returned no structured data' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const parsed = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify({ recipe: parsed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? 'unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
