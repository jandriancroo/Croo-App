import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Generate embedding using Lovable AI (extract from structured tool call)
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "You are an embedding generator. Given text, produce a semantic representation.",
          },
          {
            role: "user",
            content: `Generate a 768-dimensional embedding vector for the following text. Return ONLY the raw JSON array of 768 floating-point numbers, nothing else:\n\n"${text}"`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "store_embedding",
              description: "Store a 768-dimensional embedding vector",
              parameters: {
                type: "object",
                properties: {
                  embedding: {
                    type: "array",
                    items: { type: "number" },
                    description: "768-dimensional embedding vector",
                  },
                },
                required: ["embedding"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "store_embedding" } },
      }),
    });

    if (!resp.ok) {
      console.error("Embedding API error:", resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      if (Array.isArray(args.embedding) && args.embedding.length === 768) {
        return args.embedding;
      }
    }
    return null;
  } catch (e) {
    console.error("Embedding generation failed:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user auth
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action;

    const deny = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // The DB client below uses the service role (needed for vector RPC), so RLS
    // does NOT apply. Enforce role + location scoping explicitly here.
    const requireManagerAtLocation = async (locationId: string | null) => {
      if (!locationId) return deny(400, "Missing location_id");
      const { data: isManager, error: roleErr } = await supabaseUser.rpc("has_role_or_higher", {
        _user_id: user.id,
        _minimum_role: "manager",
      });
      if (roleErr || isManager !== true) return deny(403, "Forbidden");
      const { data: hasLoc, error: locErr } = await supabaseUser.rpc("has_location_access", {
        _user_id: user.id,
        _location_id: locationId,
      });
      if (locErr || hasLoc !== true) return deny(403, "Forbidden");
      return null;
    };

    if (action === "save") {
      // Save knowledge with embedding
      const { location_id, content, topic } = body;
      const guard = await requireManagerAtLocation(location_id);
      if (guard) return guard;
      if (!location_id || !content) {

        return new Response(JSON.stringify({ error: "Missing location_id or content" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate embedding
      const embedding = await generateEmbedding(content);

      // Save to database (embedding may be null if generation failed — still save the text)
      const insertData: any = {
        location_id,
        topic: topic || "general",
        content,
        created_by: user.id,
      };
      if (embedding) {
        insertData.embedding = JSON.stringify(embedding);
      }

      const { data, error } = await supabaseUser
        .from("theo_knowledge")
        .insert(insertData)
        .select("id, topic, content, created_at")
        .single();

      if (error) {
        console.error("Save error:", error);
        return new Response(JSON.stringify({ error: "Failed to save knowledge" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, saved: data, has_embedding: !!embedding }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "search") {
      // Search for relevant knowledge
      const { location_id, query } = body;
      if (!location_id || !query) {
        return new Response(JSON.stringify({ error: "Missing location_id or query" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate embedding for the query
      const queryEmbedding = await generateEmbedding(query);
      
      if (!queryEmbedding) {
        // Fallback: text search if embedding fails
        const { data, error } = await supabaseUser
          .from("theo_knowledge")
          .select("id, topic, content")
          .eq("location_id", location_id)
          .ilike("content", `%${query.substring(0, 50)}%`)
          .limit(3);
        
        return new Response(
          JSON.stringify({ results: data || [], method: "text_fallback" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Use similarity search
      const { data, error } = await supabaseUser.rpc("search_theo_knowledge", {
        p_location_id: location_id,
        p_embedding: JSON.stringify(queryEmbedding),
        p_limit: 3,
      });

      if (error) {
        console.error("Search error:", error);
        return new Response(JSON.stringify({ results: [], error: error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Filter by minimum similarity threshold
      const relevant = (data || []).filter((r: any) => r.similarity > 0.3);

      return new Response(
        JSON.stringify({ results: relevant, method: "vector" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list") {
      const { location_id } = body;
      const { data, error } = await supabaseUser
        .from("theo_knowledge")
        .select("id, topic, content, created_at, created_by")
        .eq("location_id", location_id)
        .order("created_at", { ascending: false })
        .limit(50);

      return new Response(
        JSON.stringify({ entries: data || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "delete") {
      const { id } = body;
      const { error } = await supabaseUser
        .from("theo_knowledge")
        .delete()
        .eq("id", id);

      return new Response(
        JSON.stringify({ success: !error }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("theo-memory error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
