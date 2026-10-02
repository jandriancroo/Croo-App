// Classifies raw inventory category names into P&L segments using Lovable AI.
// Returns: { mapping: { [rawCategory]: "Food" | "Paper" | "Beverages" | "Supplies" | "Alcohol" | "Other" } }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEGMENTS = ["Food", "Paper", "Beverages", "Supplies", "Alcohol", "Other"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { categories } = await req.json();
    if (!Array.isArray(categories) || categories.length === 0) {
      return new Response(JSON.stringify({ mapping: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const unique = Array.from(new Set(categories.map((c: string) => String(c).trim()).filter(Boolean)));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You classify restaurant inventory category names into one of these P&L COGS segments:
- Food: produce, meat, cheese, dairy, dough, sauce, condiments, dry goods, prep ingredients, desserts
- Paper: paper goods, packaging, to-go containers, napkins, cups, lids
- Beverages: non-alcoholic drinks, fountain, soda, juice, coffee, tea
- Supplies: cleaning, chemicals, sanitizer, smallwares, office, uniforms
- Alcohol: beer, wine, liquor, spirits
- Other: anything that does not clearly fit above

Return STRICT JSON only: {"mapping":{"<category>":"<Segment>", ...}} for every input.`;

    const user = `Categories: ${JSON.stringify(unique)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: "AI gateway error", detail: t }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const raw = parsed?.mapping || {};

    // Sanitize: ensure each category maps to a known segment; default unknowns to Other.
    const mapping: Record<string, string> = {};
    for (const c of unique) {
      const v = String(raw[c] ?? "").trim();
      mapping[c] = (SEGMENTS as readonly string[]).includes(v) ? v : "Other";
    }

    return new Response(JSON.stringify({ mapping }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
