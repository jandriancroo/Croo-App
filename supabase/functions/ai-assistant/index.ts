import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Tool definitions for the AI model
const tools = [
  {
    type: "function",
    function: {
      name: "query_sales",
      description: "Query sales data including net sales, guest count, pizza count, avg ticket, projections, and product mix (menu items sold with quantities). Use for questions about revenue, sales performance, items sold, product mix, and comparisons between dates.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD (defaults to start_date if omitted)" },
          include_product_mix: { type: "boolean", description: "Include item-level sales breakdown (product mix)" },
          include_hourly: { type: "boolean", description: "Include hourly sales breakdown" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_labor",
      description: "Query labor data: labor cost, hours, overtime, employee breakdown. Also queries individual time punches (clock in/out times) for specific employees or all staff on a date.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
          include_punches: { type: "boolean", description: "Include individual clock in/out punch records" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_schedule",
      description: "Query scheduled shifts for a location on specific dates. Shows who is scheduled, shift times, and coverage.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_checklists",
      description: "Query checklist completion data including individual item responses. Use for questions like 'who temped the tomatoes on AM Line check', 'what was the walk-in temp', 'did anyone complete the opening checklist'. Returns each checklist item question, the response text (including temperatures), who completed it, and when.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD" },
          checklist_title: { type: "string", description: "Filter by checklist title (partial match, e.g. 'AM Line' or 'opening')" },
          item_keyword: { type: "string", description: "Filter checklist items by keyword in the question (e.g. 'tomato', 'walk-in', 'temp')" },
          include_responses: { type: "boolean", description: "Include individual item-level responses with who completed each item. Default true." },
        },
        required: ["location_id", "date"],
      },
    },
  },
];

// Execute tool calls against the database
async function executeTool(supabase: any, toolName: string, args: any): Promise<string> {
  try {
    switch (toolName) {
      case "query_sales": {
        const endDate = args.end_date || args.start_date;
        const { data, error } = await supabase
          .from("sales_cache")
          .select("sale_date, net_sales, guest_count, pizza_count, avg_ticket, projected_sales, living_projection, override_projection, initial_projection, hourly_data, product_mix")
          .eq("location_id", args.location_id)
          .gte("sale_date", args.start_date)
          .lte("sale_date", endDate)
          .order("sale_date");
        if (error) return JSON.stringify({ error: error.message });

        // Trim data to reduce token usage
        const results = (data || []).map((row: any) => {
          const r: any = {
            date: row.sale_date,
            net_sales: row.net_sales,
            guest_count: row.guest_count,
            pizza_count: row.pizza_count,
            avg_ticket: row.avg_ticket,
            projection: row.override_projection || row.living_projection || row.initial_projection || row.projected_sales,
          };
          if (args.include_hourly && row.hourly_data) {
            r.hourly = row.hourly_data;
          }
          if (args.include_product_mix && row.product_mix) {
            r.product_mix = row.product_mix;
          }
          return r;
        });
        return JSON.stringify(results);
      }

      case "query_labor": {
        const endDate = args.end_date || args.start_date;
        // Get labor cache summary
        const { data: laborData, error: laborError } = await supabase
          .from("labor_cache")
          .select("labor_date, source, labor_cost, labor_hours, regular_hours, overtime_hours, employee_breakdown")
          .eq("location_id", args.location_id)
          .gte("labor_date", args.start_date)
          .lte("labor_date", endDate)
          .order("labor_date");
        if (laborError) return JSON.stringify({ error: laborError.message });

        const result: any = { labor_summary: laborData };

        // Get individual punches if requested
        if (args.include_punches) {
          const startTs = `${args.start_date}T00:00:00-08:00`;
          const endTs = `${endDate}T23:59:59-08:00`;
          let punchQuery = supabase
            .from("time_punches")
            .select("user_id, punch_type, punch_time, notes, profiles(full_name)")
            .eq("location_id", args.location_id)
            .gte("punch_time", startTs)
            .lte("punch_time", endTs)
            .order("punch_time");

          const { data: punches, error: punchError } = await punchQuery;
          if (punchError) return JSON.stringify({ error: punchError.message });

          let punchResults = (punches || []).map((p: any) => ({
            name: p.profiles?.full_name,
            type: p.punch_type,
            time: p.punch_time,
            notes: p.notes,
          }));

          // Filter by name if provided
          if (args.employee_name) {
            const q = args.employee_name.toLowerCase();
            punchResults = punchResults.filter((p: any) => p.name?.toLowerCase().includes(q));
          }
          result.punches = punchResults;
        }

        return JSON.stringify(result);
      }

      case "query_schedule": {
        const endDate = args.end_date || args.start_date;
        const { data, error } = await supabase
          .from("scheduled_shifts")
          .select("shift_date, start_time, end_time, is_time_off, user_id, profiles(full_name), schedules!inner(location_id)")
          .eq("schedules.location_id", args.location_id)
          .gte("shift_date", args.start_date)
          .lte("shift_date", endDate)
          .order("shift_date")
          .order("start_time");
        if (error) return JSON.stringify({ error: error.message });

        let results = (data || []).map((s: any) => ({
          date: s.shift_date,
          name: s.profiles?.full_name,
          start: s.start_time,
          end: s.end_time,
          time_off: s.is_time_off,
        }));

        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          results = results.filter((s: any) => s.name?.toLowerCase().includes(q));
        }
        return JSON.stringify(results);
      }

      case "query_checklists": {
        const startTs = `${args.date}T00:00:00-08:00`;
        const endTs = `${args.date}T23:59:59-08:00`;
        const includeResponses = args.include_responses !== false;

        // Get submissions with full response detail
        const { data, error } = await supabase
          .from("checklist_submissions")
          .select(`
            submitted_at, submitted_by, 
            profiles(full_name), 
            checklists(title),
            checklist_responses(
              item_id, response_text, response_image_url, 
              extracted_temperature, temperature_valid, completed_by,
              checklist_items(question, item_type, requires_temperature_validation)
            )
          `)
          .eq("location_id", args.location_id)
          .gte("submitted_at", startTs)
          .lte("submitted_at", endTs);

        if (error) return JSON.stringify({ error: error.message });

        // Get profiles for completed_by IDs
        const completedByIds = new Set<string>();
        (data || []).forEach((s: any) => {
          s.checklist_responses?.forEach((r: any) => {
            if (r.completed_by) completedByIds.add(r.completed_by);
          });
        });
        
        let profileMap: Record<string, string> = {};
        if (completedByIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", Array.from(completedByIds));
          (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
        }

        let results = (data || []).map((s: any) => {
          const base: any = {
            checklist: s.checklists?.title,
            submitted_by: s.profiles?.full_name,
            submitted_at: s.submitted_at,
            responses_count: s.checklist_responses?.length || 0,
          };

          if (includeResponses && s.checklist_responses) {
            let responses = s.checklist_responses.map((r: any) => ({
              question: r.checklist_items?.question,
              item_type: r.checklist_items?.item_type,
              answer: r.response_text,
              temperature: r.extracted_temperature,
              temp_valid: r.temperature_valid,
              completed_by: r.completed_by ? profileMap[r.completed_by] || r.completed_by : s.profiles?.full_name,
              has_photo: !!r.response_image_url,
            }));

            // Filter by item keyword if provided
            if (args.item_keyword) {
              const kw = args.item_keyword.toLowerCase();
              responses = responses.filter((r: any) => r.question?.toLowerCase().includes(kw));
            }

            base.responses = responses;
          }
          return base;
        });

        if (args.checklist_title) {
          const q = args.checklist_title.toLowerCase();
          results = results.filter((r: any) => r.checklist?.toLowerCase().includes(q));
        }
        return JSON.stringify(results);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Verify auth
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    // Get user from token
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify manager+ role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    
    const managerRoles = ["shift_manager", "manager", "general_manager", "admin", "org_admin", "fbc", "brand_admin", "super_admin"];
    if (!roleData || !managerRoles.includes(roleData.role)) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, location_id, location_name } = await req.json();
    const timezone = "America/Los_Angeles";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: timezone });

    const systemPrompt = `You are CrooAI, an intelligent ops assistant for restaurant managers at ${location_name || "this location"}.

Current date: ${today} (timezone: ${timezone})
Yesterday: ${yesterday}
Location ID: ${location_id}

You have access to tools to query real-time data. ALWAYS use tools to get data before answering - never guess.

Guidelines:
- Format currency with $ and commas. Format times in 12-hour AM/PM.
- Keep answers concise but complete.
- When comparing dates, query both dates.
- For product mix questions (e.g. "how many Detroit style pizzas"), use query_sales with include_product_mix=true and search through the items.
- For employee punch questions, use query_labor with include_punches=true and the employee name.
- "Today" = ${today}, "yesterday" = ${yesterday}.
- If data is unavailable, say so clearly.
- Use markdown for formatting when it improves readability.`;

    // Build initial AI request
    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    // Agentic tool loop - handle multiple rounds of tool calls
    let finalResponse: any = null;
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let currentMessages = [...aiMessages];

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      const aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: currentMessages,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!aiResp.ok) {
        const status = aiResp.status;
        const errText = await aiResp.text();
        console.error("AI error:", status, errText);
        
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited, please try again in a moment." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI error: ${status}`);
      }

      const aiData = await aiResp.json();
      const choice = aiData.choices?.[0];
      
      if (!choice) throw new Error("No AI response");

      // If no tool calls, we have the final answer
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        finalResponse = choice.message.content;
        break;
      }

      // Execute all tool calls
      currentMessages.push(choice.message);
      
      for (const tc of choice.message.tool_calls) {
        const args = typeof tc.function.arguments === "string" 
          ? JSON.parse(tc.function.arguments) 
          : tc.function.arguments;
        
        console.log(`Executing tool: ${tc.function.name}`, args);
        const result = await executeTool(supabaseAdmin, tc.function.name, args);
        
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    if (!finalResponse) {
      finalResponse = "I wasn't able to fully process your request. Please try rephrasing.";
    }

    return new Response(JSON.stringify({ content: finalResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
