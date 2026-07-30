import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // AI vision on government IDs — signed-in users only.
  const denied = await requireAuthorizedCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { imageBase64, employeeName, documentType } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are an expert document verification AI. Analyze the provided ID document image and return a structured assessment.

You MUST call the validate_document function with your findings. Be thorough but fast.

Key checks:
1. IMAGE QUALITY: Is the document photographed on a flat surface with good lighting? Is it tilted, blurry, or obstructed?
2. DOCUMENT TYPE: Does it match the expected type (${documentType || "government ID"})?
3. NAME EXTRACTION: Extract the full name printed on the document exactly as written.
4. NAME MATCH: Compare the extracted name against the expected employee name: "${employeeName}". Consider common variations (e.g., "Robert" vs "Bob", middle names present/absent). Be lenient on minor differences but flag clear mismatches.
5. EXPIRATION DATE: Extract the expiration date if visible. Determine if the document is expired based on today's date (${new Date().toISOString().split("T")[0]}).
6. DOCUMENT REGION: Identify the approximate region on the image where the name appears, as percentage coordinates (top, left, width, height) relative to the full image.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
                {
                  type: "text",
                  text: `Analyze this ${documentType || "ID"} document. The expected employee name is "${employeeName}". Validate quality, name match, and expiration.`,
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "validate_document",
                description:
                  "Return structured validation results for the document image.",
                parameters: {
                  type: "object",
                  properties: {
                    quality: {
                      type: "object",
                      properties: {
                        is_flat_surface: {
                          type: "boolean",
                          description: "Document appears to be on a flat surface",
                        },
                        is_readable: {
                          type: "boolean",
                          description: "Text on document is readable",
                        },
                        issues: {
                          type: "array",
                          items: { type: "string" },
                          description:
                            "List of quality issues (blurry, tilted, glare, etc.)",
                        },
                      },
                      required: ["is_flat_surface", "is_readable", "issues"],
                    },
                    name: {
                      type: "object",
                      properties: {
                        extracted_name: {
                          type: "string",
                          description: "Full name as printed on the document",
                        },
                        matches_employee: {
                          type: "boolean",
                          description:
                            "Whether extracted name matches expected employee name",
                        },
                        confidence: {
                          type: "number",
                          description: "Confidence of name match 0-100",
                        },
                        region: {
                          type: "object",
                          description:
                            "Approximate bounding box of name on image as percentages",
                          properties: {
                            top: { type: "number" },
                            left: { type: "number" },
                            width: { type: "number" },
                            height: { type: "number" },
                          },
                          required: ["top", "left", "width", "height"],
                        },
                      },
                      required: [
                        "extracted_name",
                        "matches_employee",
                        "confidence",
                        "region",
                      ],
                    },
                    expiration: {
                      type: "object",
                      properties: {
                        date_found: {
                          type: "boolean",
                          description: "Whether an expiration date was found",
                        },
                        expiration_date: {
                          type: "string",
                          description:
                            "Expiration date in YYYY-MM-DD format, or null",
                        },
                        is_expired: {
                          type: "boolean",
                          description: "Whether the document is expired",
                        },
                      },
                      required: ["date_found", "is_expired"],
                    },
                    is_valid_document: {
                      type: "boolean",
                      description:
                        "Overall: is this a valid, unexpired document with matching name on a flat surface?",
                    },
                    summary: {
                      type: "string",
                      description: "One-line human-readable summary of the validation",
                    },
                  },
                  required: [
                    "quality",
                    "name",
                    "expiration",
                    "is_valid_document",
                    "summary",
                  ],
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "validate_document" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again in a moment" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();

    // Extract the tool call arguments
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No validation result returned from AI");
    }

    let validation;
    try {
      validation =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
    } catch {
      throw new Error("Failed to parse validation result");
    }

    return new Response(JSON.stringify(validation), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("document-validation error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
