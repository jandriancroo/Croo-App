import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get today in PST as a real yyyy-mm-dd (avoid the toLocaleString -> new Date roundtrip
    // which silently shifts the date back into UTC).
    const pstParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = pstParts.find((p) => p.type === "year")!.value;
    const m = pstParts.find((p) => p.type === "month")!.value;
    const d = pstParts.find((p) => p.type === "day")!.value;
    const today = `${y}-${m}-${d}`;
    // Compute yesterday off the PST calendar date (use UTC math on the date-only value
    // to dodge DST landmines).
    const yest = new Date(`${today}T12:00:00Z`);
    yest.setUTCDate(yest.getUTCDate() - 1);
    const yesterdayStr = yest.toISOString().slice(0, 10);
    // Re-derive a "now in PST" Date for weekday formatting only.
    const nowPST = new Date();

    // Get all active locations
    const { data: locations, error: locErr } = await supabase
      .from("locations")
      .select("id, name")
      .eq("is_active", true);

    if (locErr || !locations?.length) {
      return new Response(JSON.stringify({ error: "No locations", detail: locErr?.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const loc of locations) {
      try {
        // Skip if briefing already exists for today
        const { data: existing } = await supabase
          .from("croo_ai_briefings")
          .select("id")
          .eq("location_id", loc.id)
          .eq("briefing_date", today)
          .maybeSingle();

        if (existing) {
          results.push({ location: loc.name, status: "exists" });
          continue;
        }

        // Gather data for the briefing
        const [laborInsight, salesData, todaySchedule, pendingRequests, cateringOrders] = await Promise.all([
          supabase
            .from("labor_insights")
            .select("analysis")
            .eq("location_id", loc.id)
            .eq("insight_date", yesterdayStr)
            .maybeSingle(),
          supabase
            .from("sales_cache")
            .select("net_sales, guest_count, labor_percent")
            .eq("location_id", loc.id)
            .eq("sale_date", yesterdayStr)
            .maybeSingle(),
          supabase
            .from("scheduled_shifts")
            .select("id, start_time, end_time, user_id")
            .eq("location_id", loc.id)
            .gte("start_time", today + "T00:00:00")
            .lte("start_time", today + "T23:59:59")
            .order("start_time"),
          supabase
            .from("availability_requests")
            .select("id, start_date, request_type, user_id")
            .eq("location_id", loc.id)
            .eq("status", "pending")
            .limit(10),
          supabase
            .from("catering_orders")
            .select("customer_name, pickup_date, pickup_time, total_price, headcount")
            .eq("location_id", loc.id)
            .gte("pickup_date", today)
            .lte("pickup_date", today)
            .eq("status", "pending"),
        ]);

        // Get profile names for scheduled shifts
        const userIds = [...new Set((todaySchedule.data || []).map((s: any) => s.user_id).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          if (profiles) {
            for (const p of profiles) {
              profileMap[p.id] = p.full_name || "Unknown";
            }
          }
        }

        // Build context for AI
        const context: string[] = [];
        context.push(`Location: ${loc.name}`);
        context.push(`Today: ${today} (${new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }).format(nowPST)})`);

        if (salesData.data) {
          const s = salesData.data;
          context.push(`Yesterday's Sales: $${Math.round(s.net_sales || 0).toLocaleString()}, ${s.guest_count || 0} guests`);
        } else {
          context.push(`Yesterday's Sales: DATA UNAVAILABLE`);
        }

        if (laborInsight.data?.analysis) {
          const a = laborInsight.data.analysis as any;
          if (a.summary) {
            context.push(`Labor Grade: ${a.summary.overallGrade} — ${a.summary.headline}`);
            context.push(`Labor %: ${a.summary.laborPercent}%, Savings Opportunity: $${Math.round(a.summary.totalSavingsOpportunity || 0)}`);
          } else {
            context.push(`Labor Grade: DATA UNAVAILABLE`);
          }
          if (a.keyFindings?.length) {
            context.push(`Key Findings: ${a.keyFindings.slice(0, 3).map((f: any) => `[${f.severity}] ${f.title}: ${f.detail}`).join(" | ")}`);
          } else {
            context.push(`Key Findings: DATA UNAVAILABLE`);
          }
          if (a.todaySuggestions?.length) {
            context.push(`AI Suggestions: ${a.todaySuggestions.map((s: any) => s.suggestion).join(" | ")}`);
          } else {
            context.push(`AI Suggestions: DATA UNAVAILABLE`);
          }
        } else {
          context.push(`Labor Grade: DATA UNAVAILABLE`);
          context.push(`Key Findings: DATA UNAVAILABLE`);
          context.push(`AI Suggestions: DATA UNAVAILABLE`);
        }

        if (todaySchedule.data?.length) {
          const names = todaySchedule.data
            .map((s: any) => {
              const name = profileMap[s.user_id] || "Unknown";
              const start = new Date(s.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
              return `${name.split(" ")[0]} (${start})`;
            })
            .slice(0, 15);
          context.push(`Today's Schedule (${todaySchedule.data.length} shifts): ${names.join(", ")}`);
        } else {
          context.push(`Today's Schedule: DATA UNAVAILABLE`);
        }

        if (pendingRequests.data?.length) {
          context.push(`Pending Time-Off Requests: ${pendingRequests.data.length}`);
        } else {
          context.push(`Pending Time-Off Requests: 0`);
        }

        if (cateringOrders.data?.length) {
          context.push(`Today's Catering: ${cateringOrders.data.map((c: any) => `${c.customer_name} at ${c.pickup_time} ($${c.total_price || 0})`).join(", ")}`);
        } else {
          context.push(`Today's Catering: NONE SCHEDULED`);
        }

        // Generate the briefing via AI
        const aiResponse = await fetch(AI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are Theo, the morning operations assistant for a restaurant location. Generate a concise, actionable morning briefing that a manager reads with their coffee. Use markdown formatting.

CRITICAL ANTI-HALLUCINATION RULE: Only reference data explicitly provided in the context below. If any item says "DATA UNAVAILABLE", say so naturally (e.g., "Yesterday's sales data isn't available yet" or "Labor grade not posted yet") — NEVER invent numbers, employee names, catering customers, or events. If catering says "NONE SCHEDULED", do not mention catering. Do not fabricate any specifics that are not in the provided context. It is far better to omit a section or say data is missing than to invent a single fact.

Structure:
1. **Good Morning** — One-line energy-setting summary of the day ahead
2. **Yesterday's Recap** — Sales, labor grade, key wins/misses (2-3 bullet points max)
3. **Today's Coverage** — Who's on, any gaps, shift timing highlights
4. **Action Items** — 2-3 specific, actionable things to watch today based on labor intelligence suggestions and schedule
5. **Heads Up** — Catering orders, pending requests, or anything else notable (skip section entirely if nothing)

Keep it under 250 words. Be conversational but data-driven. Use specific numbers. If labor grade was C or below, lead with that urgency. If there are savings opportunities, call them out specifically. Don't use emoji in headers.`
              },
              {
                role: "user",
                content: `Generate the morning briefing for today using this data:\n\n${context.join("\n")}`
              }
            ],
          }),
        });

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          console.error(`AI error for ${loc.name}:`, aiResponse.status, errText);
          results.push({ location: loc.name, status: "ai_error", code: aiResponse.status });
          continue;
        }

        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content;

        if (!content) {
          results.push({ location: loc.name, status: "empty_response" });
          continue;
        }

        // Store the briefing
        const { error: insertErr } = await supabase
          .from("croo_ai_briefings")
          .insert({
            location_id: loc.id,
            briefing_date: today,
            content,
          });

        if (insertErr) {
          console.error(`Insert error for ${loc.name}:`, insertErr);
          results.push({ location: loc.name, status: "insert_error", detail: insertErr.message });
        } else {
          results.push({ location: loc.name, status: "generated" });
        }
      } catch (locErr: any) {
        console.error(`Error for ${loc.name}:`, locErr);
        results.push({ location: loc.name, status: "error", detail: locErr.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-daily-briefing error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});